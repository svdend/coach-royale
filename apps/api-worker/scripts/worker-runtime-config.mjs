import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import process from "node:process";

const WRANGLER_OUTPUT_PATH =
  process.env.WORKER_WRANGLER_OUTPUT_PATH?.trim() ||
  ".wrangler/production.toml";
const WORKER_NAME = "coachroyale-api";

const REQUIRED_VAR_SPECS = [
  ["WORKER_ALLOWED_ORIGINS", "ALLOWED_ORIGINS"],
  ["WORKER_ANTHROPIC_MODEL", "ANTHROPIC_MODEL"],
  ["WORKER_WORKERS_AI_MODEL", "WORKERS_AI_MODEL"],
  ["WORKER_AI_GATEWAY_ID", "AI_GATEWAY_ID"],
  ["WORKER_RELAY_BASE_URL", "RELAY_BASE_URL"],
  ["WORKER_SUPABASE_URL", "SUPABASE_URL"],
  ["WORKER_LEMONSQUEEZY_STORE_ID", "LEMONSQUEEZY_STORE_ID"],
  ["WORKER_LEMONSQUEEZY_VARIANT_ID", "LEMONSQUEEZY_VARIANT_ID"],
];

const OPTIONAL_VAR_SPECS = [
  ["WORKER_APP_BASE_URL", "APP_BASE_URL"],
  ["WORKER_STRUCTURED_LOGS_ENABLED", "STRUCTURED_LOGS_ENABLED"],
  // Custom/self-hosted model lane (Phase 1 custom AI provider).
  // URL and model name are non-secret routing config; key + shared secret are
  // stored as Worker secrets and verified by verify-remote-secrets below.
  ["WORKER_CUSTOM_MODEL_URL", "CUSTOM_MODEL_URL"],
  ["WORKER_CUSTOM_MODEL_NAME", "CUSTOM_MODEL_NAME"],
  ["WORKER_OPERATOR_USER_IDS", "OPERATOR_USER_IDS"],
];

const REQUIRED_SECRET_NAMES = [
  "RELAY_SHARED_SECRET",
  "SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "LEMONSQUEEZY_API_KEY",
  "LEMONSQUEEZY_WEBHOOK_SECRET",
];

const OPTIONAL_SECRET_NAMES = [
  "ANTHROPIC_API_KEY",
  // Custom/self-hosted model lane (Phase 1 custom AI provider).
  // Both optional: the lane silently no-ops if either is missing, and the
  // router falls back to Anthropic.
  "CUSTOM_MODEL_KEY",
  "CUSTOM_MODEL_SHARED_SECRET",
];

function getMode() {
  const [, , mode] = process.argv;
  if (!mode) {
    throw new Error(
      "Expected a mode. Use one of: render-production, verify-remote-secrets.",
    );
  }
  return mode;
}

function readRequiredVars() {
  const missing = [];
  const entries = [];

  for (const [sourceName, targetName] of REQUIRED_VAR_SPECS) {
    const value = process.env[sourceName]?.trim();
    if (!value) {
      missing.push(sourceName);
      continue;
    }
    entries.push([targetName, value]);
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required worker config variable(s): ${missing.join(", ")}. ` +
        "Set them in the production-worker GitHub environment before deploying.",
    );
  }

  for (const [sourceName, targetName] of OPTIONAL_VAR_SPECS) {
    const value = process.env[sourceName]?.trim();
    if (value) {
      entries.push([targetName, value]);
    }
  }

  return entries;
}

function escapeTomlString(value) {
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function renderToml(varEntries, outputPath) {
  // Wrangler resolves `main` relative to the config file's directory, not the
  // cwd. The config is written to `outputPath` (default `.wrangler/...`), so the
  // entry point must be expressed relative to that directory or wrangler reports
  // "entry-point file ... was not found".
  const entryPoint = resolve(process.cwd(), "src/index.ts");
  const mainPath = relative(dirname(outputPath), entryPoint);
  const aiEventsDataset =
    process.env.WORKER_AI_EVENTS_DATASET?.trim() || "coachroyale_ai_events";
  // Analytics Engine requires the Workers Paid plan. It is opt-in so the Worker
  // can deploy on the free plan; the runtime already no-ops when AI_EVENTS is
  // unbound (see `if (!env.AI_EVENTS)` guards in src/index.ts). Set
  // WORKER_AI_EVENTS_ENABLED=true on a paid plan to restore the binding.
  const aiEventsEnabled =
    process.env.WORKER_AI_EVENTS_ENABLED?.trim() === "true";
  const aiEventsBinding = aiEventsEnabled
    ? [
        "[[analytics_engine_datasets]]",
        'binding = "AI_EVENTS"',
        `dataset = ${escapeTomlString(aiEventsDataset)}`,
        "",
      ]
    : [];
  const lines = [
    `name = ${escapeTomlString(WORKER_NAME)}`,
    `main = ${escapeTomlString(mainPath)}`,
    'compatibility_date = "2026-04-23"',
    "",
    "[ai]",
    'binding = "AI"',
    "",
    ...aiEventsBinding,
    "[vars]",
    ...varEntries.map(([key, value]) => `${key} = ${escapeTomlString(value)}`),
    "",
  ];
  return lines.join("\n");
}

function writeProductionConfig() {
  const varEntries = readRequiredVars();
  const outputPath = resolve(process.cwd(), WRANGLER_OUTPUT_PATH);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, renderToml(varEntries, outputPath), "utf8");
  console.log(`Wrote production Wrangler config to ${WRANGLER_OUTPUT_PATH}`);
}

function readSecretNamesFromCloudflare() {
  const output = execFileSync(
    "npx",
    ["wrangler", "secret", "list", "--name", WORKER_NAME, "--format", "json"],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const parsed = JSON.parse(output);
  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.secrets)
      ? parsed.secrets
      : [];

  return new Set(
    items
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }
        if (item && typeof item === "object") {
          return item.name ?? item.key ?? null;
        }
        return null;
      })
      .filter((value) => typeof value === "string"),
  );
}

function verifyRemoteSecrets() {
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error(
      "CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID must be set before verifying Worker secrets.",
    );
  }

  const secretNames = readSecretNamesFromCloudflare();
  const missingRequired = REQUIRED_SECRET_NAMES.filter(
    (name) => !secretNames.has(name),
  );

  if (missingRequired.length > 0) {
    throw new Error(
      `Cloudflare Worker is missing required secret(s): ${missingRequired.join(", ")}. ` +
        "Populate them in the production Worker before deploying.",
    );
  }

  const missingOptional = OPTIONAL_SECRET_NAMES.filter(
    (name) => !secretNames.has(name),
  );
  if (missingOptional.length > 0) {
    console.warn(
      `Optional Worker secret(s) not configured: ${missingOptional.join(", ")}. ` +
        "The Worker will fall back where supported.",
    );
  }

  console.log("Verified required Cloudflare Worker secrets.");
}

function main() {
  const mode = getMode();
  if (mode === "render-production") {
    writeProductionConfig();
    return;
  }
  if (mode === "verify-remote-secrets") {
    verifyRemoteSecrets();
    return;
  }

  throw new Error(
    `Unknown mode "${mode}". Use one of: render-production, verify-remote-secrets.`,
  );
}

try {
  main();
} catch (error) {
  const message =
    error instanceof Error
      ? error.message
      : "Unknown worker runtime config error.";
  console.error(message);
  process.exit(1);
}
