#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_ROOT = join(SCRIPT_DIR, "..");
const MAX_FILE_BYTES = 2 * 1024 * 1024;

const EXCLUDED_PATH_PREFIXES = [
  ".git/",
  "apps/api-worker/dist/",
  "apps/web/dist/",
  "node_modules/",
  "history/artifacts/",
];

const EXCLUDED_PATH_SUFFIXES = [
  ".avif",
  ".gif",
  ".ico",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".webp",
  ".woff",
  ".woff2",
  ".zip",
];

const ALLOWLISTED_CANDIDATES = [
  /\$\{\{\s*(?:secrets|vars)\./i,
  /anon-key/i,
  /ci-placeholder/i,
  /dummy/i,
  /example/i,
  /fixture/i,
  /placeholder/i,
  /relay-secret/i,
  /test/i,
  // Placeholder idiom used throughout docs (e.g. TODO_SUPABASE_URL,
  // TODO_RELAY_SHARED_SECRET) to mark deploy-time values. Real secrets do
  // not start with TODO_, so this is safe.
  /todo[_-]/i,
  /webhook-secret/i,
  /your-/i,
  // Code that assigns an env variable FROM another env variable.
  // e.g. `ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY` or
  // `X-Relay-Auth: env.RELAY_SHARED_SECRET`. The RHS is a reference,
  // not a literal secret value.
  /^(?:process\.env|import\.meta\.env|env)\./i,
];

const SECRET_PATTERNS = [
  {
    name: "private key",
    regex: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/giu,
  },
  {
    name: "AWS access key",
    regex: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/gu,
  },
  {
    name: "GitHub token",
    regex: /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{20,}\b/gu,
  },
  {
    name: "OpenAI API key",
    regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/gu,
  },
  {
    name: "Anthropic API key",
    regex: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/gu,
  },
  {
    name: "JWT-like secret",
    regex:
      /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/gu,
  },
  {
    name: "secret assignment",
    regex:
      /\b[A-Z0-9_]*(?:API[_-]?KEY|SECRET|TOKEN|PASSWORD|SERVICE[_-]?ROLE[_-]?KEY|WEBHOOK[_-]?SECRET)[A-Z0-9_]*\b\s*[:=]\s*["']?([A-Za-z0-9_./+=:@-]{20,})["']?/gu,
    secretGroup: 1,
  },
];

function repositoryRoot() {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: DEFAULT_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return DEFAULT_ROOT;
  }
}

function trackedFiles(root) {
  try {
    return execFileSync("git", ["ls-files", "-z"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\0")
      .filter(Boolean);
  } catch {
    return walkFiles(root).map((file) => relative(root, file));
  }
}

function walkFiles(root) {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    const stats = statSync(path);
    return stats.isDirectory() ? walkFiles(path) : [path];
  });
}

function shouldScan(path) {
  return (
    !EXCLUDED_PATH_PREFIXES.some((prefix) => path.startsWith(prefix)) &&
    !EXCLUDED_PATH_SUFFIXES.some((suffix) => path.endsWith(suffix))
  );
}

function isText(buffer) {
  return !buffer.includes(0);
}

function lineNumber(content, index) {
  return content.slice(0, index).split(/\r\n|\r|\n/u).length;
}

function redact(candidate) {
  if (candidate.length <= 8) {
    return "[redacted]";
  }
  return `${candidate.slice(0, 4)}...[redacted]...${candidate.slice(-4)}`;
}

function isAllowlisted(candidate) {
  return ALLOWLISTED_CANDIDATES.some((pattern) => pattern.test(candidate));
}

function scanFile(root, path) {
  const absolutePath = join(root, path);
  if (!existsSync(absolutePath) || !shouldScan(path)) {
    return [];
  }

  const stats = statSync(absolutePath);
  if (!stats.isFile() || stats.size > MAX_FILE_BYTES) {
    return [];
  }

  const buffer = readFileSync(absolutePath);
  if (!isText(buffer)) {
    return [];
  }

  const content = buffer.toString("utf8");
  return SECRET_PATTERNS.flatMap((pattern) =>
    Array.from(content.matchAll(pattern.regex))
      .map((match) => ({
        candidate: match[pattern.secretGroup ?? 0] ?? match[0],
        line: lineNumber(content, match.index ?? 0),
        name: pattern.name,
        path,
      }))
      .filter((finding) => !isAllowlisted(finding.candidate)),
  );
}

function main() {
  const root = repositoryRoot();
  const files = trackedFiles(root);
  const findings = files.flatMap((file) => scanFile(root, file));

  if (findings.length > 0) {
    console.error("Secret scan failed. Remove or rotate these values:");
    for (const finding of findings) {
      console.error(
        `${finding.path}:${finding.line} ${finding.name} ${redact(
          finding.candidate,
        )}`,
      );
    }
    process.exit(1);
  }

  console.log(`Secret scan passed: ${files.length} tracked files checked.`);
}

main();
