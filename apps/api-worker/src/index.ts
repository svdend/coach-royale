import { Hono } from "hono";
import type { Context } from "hono";
import { cors } from "hono/cors";
import { z } from "zod";

import {
  AiProviderUnavailableError,
  FreeLanePoolExhaustedError,
  answerCoachQuestion,
  generateAnalysisText,
  generateQuickResponse,
  generateWeeklyPlan,
  type AiTextProvider,
} from "./lib/ai";
import { runAgentTurn } from "./lib/agent";
import { buildPlayerState } from "./lib/analytics";
import { normalizeBattle } from "./lib/battles";
import {
  appendCoachMessage,
  createCoachThread,
  getCoachThread,
  listCoachMessages,
  messageRecordToAnthropic,
} from "./lib/coach-threads";
import {
  createCheckoutUrl,
  mapSubscriptionStatusToTier,
  verifyWebhookSignature,
} from "./lib/payments";
import {
  fetchRelayBattles,
  fetchRelayCards,
  fetchRelayChests,
  fetchRelayClan,
  fetchRelayPlayer,
} from "./lib/relay";
import {
  applySubscriptionUpdate,
  createAnalysisHistory,
  deleteTrackedPlayer,
  eraseUserData,
  exportUserData,
  FREE_AI_DAILY_LIMIT,
  getAuthenticatedUser,
  getManagedAiAccess,
  getPrivacySettings,
  getSubscriptionStatus,
  incrementFreeAiUsage,
  listAnalysisHistory,
  listTrackedPlayers,
  persistSyncIfAuthorized,
  readCoachAgentBetaOptIn,
  recordManagedAiAnalysis,
  setCoachAgentBetaOptIn,
  tryRecordSubscriptionWebhookEvent,
  updatePrivacySettings,
} from "./lib/supabase";
import { apiErrorResponse, HttpError } from "./lib/api-errors";
import { modelForProvider, providerForAccess } from "./lib/provider-routing";
import { normalizeTag } from "./lib/tags";
import type { Env, RawBattle } from "./types";

type AppVariables = {
  requestId: string;
};

type AppContext = Context<{ Bindings: Env; Variables: AppVariables }>;

const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
const QUICK_ANALYSIS_ERROR =
  "Daily quick-analysis limit reached. Resets at midnight UTC.";
const DEEP_ANALYSIS_ERROR =
  "Daily deep-analysis limit reached. Upgrade to Pro or try again tomorrow.";
const PRO_COACHING_UNAVAILABLE_ERROR = "coaching_unavailable";
const HSTS_HEADER = "max-age=31536000; includeSubDomains; preload";
const SECURITY_HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=()",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
} as const;

type ManagedAiAccess = Awaited<ReturnType<typeof getManagedAiAccess>>;
type FreeLaneUpsellReason = "daily_limit" | "pool_exhausted";
type ManagedAiEndpoint = "analyze" | "respond";
type ReadinessStatus = "ready" | "not_ready";

/** Cache hints for relay-backed Supercell-shaped JSON (short TTL; CDN-friendly). */
const RELAY_CACHE = {
  player: "public, max-age=60, stale-while-revalidate=300",
  battles: "public, max-age=30, stale-while-revalidate=120",
  chests: "public, max-age=120, stale-while-revalidate=600",
  clan: "public, max-age=120, stale-while-revalidate=600",
  cards: "public, max-age=3600, stale-while-revalidate=86400",
  analytics: "public, max-age=15, stale-while-revalidate=60",
} as const;

const lemonWebhookPayloadSchema = z
  .object({
    meta: z
      .object({
        custom_data: z.object({
          user_id: z.string().uuid(),
        }),
      })
      .passthrough(),
    data: z
      .object({
        id: z
          .union([z.string(), z.number()])
          .transform((value) => String(value).trim())
          .refine((value) => value.length > 0),
        attributes: z
          .object({
            status: z.string().trim().min(1),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

function isConfigured(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function buildReadiness(env: Env): {
  status: ReadinessStatus;
  service: string;
  checks: Record<string, boolean>;
} {
  const checks = {
    allowed_origins: allowedOrigins(env).length > 0,
    ai_gateway_id: isConfigured(env.AI_GATEWAY_ID),
    lemon_squeezy_api_key: isConfigured(env.LEMONSQUEEZY_API_KEY),
    lemon_squeezy_store_id: isConfigured(env.LEMONSQUEEZY_STORE_ID),
    lemon_squeezy_variant_id: isConfigured(env.LEMONSQUEEZY_VARIANT_ID),
    lemon_squeezy_webhook_secret: isConfigured(env.LEMONSQUEEZY_WEBHOOK_SECRET),
    relay_base_url: isConfigured(env.RELAY_BASE_URL),
    relay_shared_secret: isConfigured(env.RELAY_SHARED_SECRET),
    supabase_anon_key: isConfigured(env.SUPABASE_ANON_KEY),
    supabase_service_role_key: isConfigured(env.SUPABASE_SERVICE_ROLE_KEY),
    supabase_url: isConfigured(env.SUPABASE_URL),
    workers_ai_binding: env.AI !== undefined,
    workers_ai_model: isConfigured(env.WORKERS_AI_MODEL),
  };
  const ready = Object.values(checks).every(Boolean);
  return {
    status: ready ? "ready" : "not_ready",
    service: "api-worker",
    checks,
  };
}

function inferErrorCode(error: unknown, status: number): string {
  if (error instanceof HttpError && error.code) {
    return error.code;
  }
  if (error instanceof AiProviderUnavailableError) {
    return "provider_unavailable";
  }
  if (error instanceof HttpError) {
    if (error.status === 401) return "unauthorized";
    if (error.status === 403) return "forbidden";
    if (error.status === 429) return "quota_exceeded";
    if (error.status === 400) return "bad_request";
  }
  if (status === 401) return "unauthorized";
  if (status === 403) return "forbidden";
  if (status === 429) return "quota_exceeded";
  if (status === 400) return "bad_request";
  if (status === 503) return "provider_unavailable";
  return "internal_error";
}

function jsonError(c: AppContext, message: string, status = 400): Response {
  const code = inferErrorCode(new HttpError(status, message), status);
  return apiErrorResponse(c.get("requestId"), code, message, status);
}

// Compute the public-facing error message for a thrown error. Positive
// allowlist: only HttpError and a small set of mapped sentinel errors are
// considered "designed to be public". Anything else collapses to a generic
// "Internal server error" so we never leak Supabase/Anthropic/relay/upstream
// response bodies to API callers. The real error.message + stack are logged
// alongside the requestId for support correlation.
function publicMessageFor(error: unknown): string {
  if (error instanceof AiProviderUnavailableError) {
    return PRO_COACHING_UNAVAILABLE_ERROR;
  }
  if (error instanceof HttpError) {
    return error.message;
  }
  return "Internal server error";
}

function logRedactedError(
  requestId: string | undefined,
  error: unknown,
  message: string,
): void {
  // Anything not surfaced via publicMessageFor still needs to be logged so
  // on-call can correlate by requestId. Keep this best-effort — Workers
  // logs are usually scraped via wrangler tail / Logpush, not parsed.
  if (message === "Internal server error") {
    const detail =
      error instanceof Error
        ? { name: error.name, message: error.message, stack: error.stack }
        : { value: error };
    console.error(
      JSON.stringify({
        level: "error",
        request_id: requestId ?? null,
        public_message: message,
        error: detail,
      }),
    );
  }
}

function jsonErrorFromException(c: AppContext, error: unknown): Response {
  const status = statusForError(error);
  const code = inferErrorCode(error, status);
  const message = publicMessageFor(error);
  logRedactedError(c.get("requestId"), error, message);
  return apiErrorResponse(c.get("requestId"), code, message, status);
}

function requestIdFromHeader(header: string | undefined): string {
  const requestId = header?.trim();
  if (requestId && requestId.length <= 128) {
    return requestId;
  }
  return crypto.randomUUID();
}

function structuredLogsEnabled(env: Env): boolean {
  return env.STRUCTURED_LOGS_ENABLED?.trim().toLowerCase() === "true";
}

function statusForError(error: unknown): number {
  if (error instanceof HttpError) {
    return error.status;
  }
  if (error instanceof AiProviderUnavailableError) {
    return 503;
  }
  if (error instanceof Error && error.message === "Unauthorized") {
    return 401;
  }
  return 500;
}

/**
 * Per-IP rate limit guard for the unauthenticated relay routes.
 * No-ops when RELAY_LIMITER is unbound (local dev, tests). When the
 * Cloudflare binding rejects, this throws an HttpError(429) that the
 * existing error handler maps to a quota_exceeded JSON response.
 *
 * The relay's Supercell API token is unscoped to a particular caller,
 * so without this gate the public Worker is an open token-backed
 * proxy. Cloudflare's binding evaluates per CF-Connecting-IP at the
 * edge — much cheaper than running the Worker body before deciding.
 */
async function requireRelayRateLimit(c: AppContext): Promise<void> {
  const limiter = c.env.RELAY_LIMITER;
  if (!limiter) return; // local dev / tests
  const key = c.req.header("CF-Connecting-IP") ?? "unknown-ip";
  const result = await limiter.limit({ key });
  if (!result.success) {
    throw new HttpError(429, "Too many requests");
  }
}

function assertUsageBudget(params: {
  authenticated: boolean;
  tier: "free" | "pro";
  used: number;
  limit: number;
  scope: "quick" | "deep";
}) {
  if (!params.authenticated) {
    if (params.scope === "deep") {
      throw new HttpError(401, "Sign in required for deep analysis.");
    }
    return;
  }

  if (params.tier === "pro") {
    return;
  }

  if (params.used >= params.limit) {
    throw new HttpError(
      429,
      params.scope === "quick" ? QUICK_ANALYSIS_ERROR : DEEP_ANALYSIS_ERROR,
      "quota_exceeded",
    );
  }
}

function requireProAccess(
  access: Awaited<ReturnType<typeof getManagedAiAccess>>,
  message: string,
) {
  if (!access.user) {
    throw new HttpError(401, "Unauthorized");
  }

  if (access.tier !== "pro") {
    throw new HttpError(403, message);
  }
}

// Provider-routing logic lives in ./lib/provider-routing.ts so it can be
// unit-tested in isolation. The imports below re-export the names used by
// the rest of index.ts unchanged.

function buildUpgradeUrl(env: Env): string {
  const appBase = env.APP_BASE_URL?.trim().replace(/\/$/, "");
  return appBase ? `${appBase}/?upgrade=pro` : "/?upgrade=pro";
}

function buildUpsell(env: Env, reason: FreeLaneUpsellReason) {
  return {
    reason,
    cta:
      reason === "pool_exhausted"
        ? "The shared free AI pool is busy. Upgrade to Pro for dedicated coaching."
        : "Upgrade to Pro for unlimited coaching.",
    upgrade_url: buildUpgradeUrl(env),
  };
}

async function hashedUserId(userId: string | null): Promise<string> {
  if (!userId) {
    return "anonymous";
  }

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(userId),
  );
  return Array.from(new Uint8Array(digest))
    .slice(0, 12)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function writeAiEvent(
  env: Env,
  event: {
    endpoint: ManagedAiEndpoint;
    provider: AiTextProvider;
    tier: "free" | "pro";
    userId: string | null;
    model: string;
    promptChars: number;
    responseChars: number;
    startedAt: number;
    upsellReason?: FreeLaneUpsellReason;
    /**
     * True when the dispatcher attempted the custom lane and fell back
     * to Anthropic. Used to compute garage uptime / lane health without
     * double-counting requests.
     */
    fallbackUsed?: boolean;
    /**
     * The provider the router intended before any in-dispatcher fallback.
     * For non-fallback requests this is identical to `provider`.
     */
    originalProvider?: AiTextProvider;
  },
): Promise<void> {
  if (!env.AI_EVENTS) {
    return;
  }

  try {
    env.AI_EVENTS.writeDataPoint({
      indexes: [event.endpoint, event.tier, event.provider],
      blobs: [
        event.model,
        await hashedUserId(event.userId),
        event.upsellReason ?? "none",
        event.fallbackUsed ? "fallback" : "direct",
        event.originalProvider ?? event.provider,
      ],
      doubles: [
        event.promptChars,
        event.responseChars,
        event.upsellReason ? 1 : 0,
        Date.now() - event.startedAt,
        event.fallbackUsed ? 1 : 0,
      ],
    });
  } catch {
    // Telemetry must never fail the user-facing coaching request.
  }
}

async function consumeFreeLaneAllowance(
  env: Env,
  access: ManagedAiAccess,
): Promise<FreeLaneUpsellReason | null> {
  if (!access.user || access.tier === "pro") {
    return null;
  }

  const limit = access.free_ai?.daily_limit ?? FREE_AI_DAILY_LIMIT;
  if ((access.free_ai?.used_today ?? 0) >= limit) {
    return "daily_limit";
  }

  const nextCount = await incrementFreeAiUsage(env, access.user.id);
  return nextCount > limit ? "daily_limit" : null;
}

async function playerContext(env: Env, tag: string, requestId?: string) {
  const [player, rawBattles] = await Promise.all([
    fetchRelayPlayer<Record<string, unknown>>(env, tag, requestId),
    fetchRelayBattles<RawBattle[]>(env, tag, requestId),
  ]);
  const normalizedBattles = (rawBattles ?? [])
    .map((battle) => normalizeBattle(battle, tag))
    .filter((battle): battle is NonNullable<typeof battle> => battle !== null);
  const playerState = buildPlayerState(
    {
      tag: typeof player.tag === "string" ? player.tag : normalizeTag(tag),
      trophies: typeof player.trophies === "number" ? player.trophies : 0,
    },
    normalizedBattles,
  );
  return { player, rawBattles, normalizedBattles, playerState };
}

async function runManagedDeepAnalysis(c: AppContext, tag: string) {
  const startedAt = Date.now();

  try {
    const [access, context] = await Promise.all([
      getManagedAiAccess(c.env, c.req.header("Authorization")),
      playerContext(c.env, tag, c.get("requestId")),
    ]);
    const provider = providerForAccess(access, c.env);
    const model = modelForProvider(c.env, provider);
    const promptChars = JSON.stringify({
      player: context.player,
      player_state: context.playerState,
      battles: context.normalizedBattles.slice(0, 10),
    }).length;

    if (provider === "workers_ai") {
      const upsellReason = await consumeFreeLaneAllowance(c.env, access);
      if (upsellReason) {
        await writeAiEvent(c.env, {
          endpoint: "analyze",
          provider,
          tier: access.tier,
          userId: access.user?.id ?? null,
          model,
          promptChars,
          responseChars: 0,
          startedAt,
          upsellReason,
        });
        return c.json({
          analysis: "",
          text: null,
          player_state: context.playerState,
          upsell: buildUpsell(c.env, upsellReason),
        });
      }
    }

    try {
      const telemetry: { fallback_used?: boolean } = {};
      const analysis = await generateAnalysisText(
        c.env,
        context.player,
        context.playerState,
        context.normalizedBattles,
        { provider, telemetry },
      );
      // If the custom lane fell back to Anthropic, the AI event should
      // record the actual provider that served the response (anthropic)
      // while preserving the router's original choice for observability.
      const effectiveProvider: AiTextProvider =
        provider === "custom" && telemetry.fallback_used
          ? "anthropic"
          : provider;
      const effectiveModel =
        effectiveProvider === provider
          ? model
          : modelForProvider(c.env, effectiveProvider);
      await writeAiEvent(c.env, {
        endpoint: "analyze",
        provider: effectiveProvider,
        originalProvider: provider,
        fallbackUsed: telemetry.fallback_used === true,
        tier: access.tier,
        userId: access.user?.id ?? null,
        model: effectiveModel,
        promptChars,
        responseChars: analysis.length,
        startedAt,
      });
      return c.json({
        analysis,
        player_state: context.playerState,
      });
    } catch (error) {
      if (error instanceof FreeLanePoolExhaustedError) {
        await writeAiEvent(c.env, {
          endpoint: "analyze",
          provider,
          tier: access.tier,
          userId: access.user?.id ?? null,
          model,
          promptChars,
          responseChars: 0,
          startedAt,
          upsellReason: "pool_exhausted",
        });
        return c.json({
          analysis: "",
          text: null,
          player_state: context.playerState,
          upsell: buildUpsell(c.env, "pool_exhausted"),
        });
      }
      throw error;
    }
  } catch (error) {
    return jsonErrorFromException(c, error);
  }
}

app.use("*", async (c, next) => {
  const requestId = requestIdFromHeader(c.req.header("X-Request-ID"));
  const startedAt = Date.now();
  c.set("requestId", requestId);

  try {
    await next();
  } finally {
    c.header("X-Request-ID", requestId);
    if (structuredLogsEnabled(c.env)) {
      console.log(
        JSON.stringify({
          duration_ms: Date.now() - startedAt,
          method: c.req.method,
          path: new URL(c.req.url).pathname,
          request_id: requestId,
          service: "api-worker",
          status: c.res.status,
        }),
      );
    }
  }
});

app.use("*", async (c, next) => {
  return cors({
    origin: (incomingOrigin) => {
      if (!incomingOrigin) return "";
      return allowedOrigins(c.env).includes(incomingOrigin)
        ? incomingOrigin
        : "";
    },
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "X-Request-ID"],
    exposeHeaders: ["X-Request-ID"],
    maxAge: 86400,
  })(c, next);
});

app.use("*", async (c, next) => {
  await next();

  for (const [header, value] of Object.entries(SECURITY_HEADERS)) {
    c.header(header, value);
  }

  if (new URL(c.req.url).protocol === "https:") {
    c.header("Strict-Transport-Security", HSTS_HEADER);
  }
});

app.get("/api/health", (c) =>
  c.json({
    status: "ok",
    service: "api-worker",
  }),
);

app.get("/api/ready", (c) => {
  const readiness = buildReadiness(c.env);
  return c.json(readiness, readiness.status === "ready" ? 200 : 503);
});

app.get("/api/player/:tag", async (c) => {
  try {
    await requireRelayRateLimit(c);
    const player = await fetchRelayPlayer<Record<string, unknown>>(
      c.env,
      c.req.param("tag"),
      c.get("requestId"),
    );
    return c.json(player, 200, { "Cache-Control": RELAY_CACHE.player });
  } catch (error) {
    return jsonErrorFromException(c, error);
  }
});

app.get("/api/player/:tag/battles", async (c) => {
  try {
    await requireRelayRateLimit(c);
    const battles = await fetchRelayBattles<RawBattle[]>(
      c.env,
      c.req.param("tag"),
      c.get("requestId"),
    );
    return c.json(battles, 200, { "Cache-Control": RELAY_CACHE.battles });
  } catch (error) {
    return jsonErrorFromException(c, error);
  }
});

app.get("/api/player/:tag/chests", async (c) => {
  try {
    await requireRelayRateLimit(c);
    const chests = await fetchRelayChests<Record<string, unknown>>(
      c.env,
      c.req.param("tag"),
      c.get("requestId"),
    );
    return c.json(chests, 200, { "Cache-Control": RELAY_CACHE.chests });
  } catch (error) {
    return jsonErrorFromException(c, error);
  }
});

app.get("/api/player/:tag/analytics", async (c) => {
  try {
    const context = await playerContext(
      c.env,
      c.req.param("tag"),
      c.get("requestId"),
    );
    return c.json({ player_state: context.playerState }, 200, {
      "Cache-Control": RELAY_CACHE.analytics,
    });
  } catch (error) {
    return jsonErrorFromException(c, error);
  }
});

app.get("/api/clan/:tag", async (c) => {
  try {
    await requireRelayRateLimit(c);
    const clan = await fetchRelayClan<Record<string, unknown>>(
      c.env,
      c.req.param("tag"),
      c.get("requestId"),
    );
    return c.json(clan, 200, { "Cache-Control": RELAY_CACHE.clan });
  } catch (error) {
    return jsonErrorFromException(c, error);
  }
});

app.get("/api/cards", async (c) => {
  try {
    await requireRelayRateLimit(c);
    const cards = await fetchRelayCards<Record<string, unknown>>(
      c.env,
      c.get("requestId"),
    );
    return c.json(cards, 200, { "Cache-Control": RELAY_CACHE.cards });
  } catch (error) {
    return jsonErrorFromException(c, error);
  }
});

app.post("/api/player/:tag/sync", async (c) => {
  const tag = c.req.param("tag");
  const { player, rawBattles } = await playerContext(
    c.env,
    tag,
    c.get("requestId"),
  );
  await persistSyncIfAuthorized({
    env: c.env,
    authorizationHeader: c.req.header("Authorization"),
    tag,
    player,
    battles: rawBattles,
  });
  return c.json({
    player,
    battles_synced: rawBattles.length,
    battles_added: rawBattles.length,
  });
});

app.post("/api/analysis", async (c) => {
  const bodySchema = z.object({
    tag: z.string().min(1),
  });
  const parsed = bodySchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(c, "Request body must include tag", 400);
  }

  const tag = normalizeTag(parsed.data.tag);
  return runManagedDeepAnalysis(c, tag);
});

app.post("/api/ai/respond", async (c) => {
  const schema = z.object({
    prompt: z.string().min(1),
    playerData: z.record(z.unknown()).default({}),
    type: z.enum(["quick_stats", "deck_tips", "battle_summary"]),
    player_tag: z.string().min(1).optional(),
    analysis_scope: z.enum(["quick", "deep"]).optional().default("quick"),
  });
  const parsed = schema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(
      c,
      "Request body must include prompt, playerData, and type",
    );
  }

  try {
    const access = await getManagedAiAccess(
      c.env,
      c.req.header("Authorization"),
    );
    const analysisScope = parsed.data.analysis_scope;
    const usageKey =
      analysisScope === "deep" ? "deep_analysis" : "quick_analysis";

    assertUsageBudget({
      authenticated: access.user !== null,
      tier: access.tier,
      used: access.usage[usageKey],
      limit: access.limits[usageKey],
      scope: analysisScope,
    });

    const provider = providerForAccess(access, c.env);
    const model = modelForProvider(c.env, provider);
    const startedAt = Date.now();
    const promptChars =
      parsed.data.prompt.length + JSON.stringify(parsed.data.playerData).length;

    if (provider === "workers_ai") {
      const upsellReason = await consumeFreeLaneAllowance(c.env, access);
      if (upsellReason) {
        await writeAiEvent(c.env, {
          endpoint: "respond",
          provider,
          tier: access.tier,
          userId: access.user?.id ?? null,
          model,
          promptChars,
          responseChars: 0,
          startedAt,
          upsellReason,
        });
        return c.json({
          success: false,
          result: {
            response: "",
          },
          text: null,
          upsell: buildUpsell(c.env, upsellReason),
        });
      }
    }

    let response: string;
    const respondTelemetry: { fallback_used?: boolean } = {};
    try {
      response = await generateQuickResponse(
        c.env,
        parsed.data.prompt,
        parsed.data.playerData,
        parsed.data.type,
        {
          provider,
          telemetry: respondTelemetry,
        },
      );
    } catch (error) {
      if (error instanceof FreeLanePoolExhaustedError) {
        await writeAiEvent(c.env, {
          endpoint: "respond",
          provider,
          tier: access.tier,
          userId: access.user?.id ?? null,
          model,
          promptChars,
          responseChars: 0,
          startedAt,
          upsellReason: "pool_exhausted",
        });
        return c.json({
          success: false,
          result: {
            response: "",
          },
          text: null,
          upsell: buildUpsell(c.env, "pool_exhausted"),
        });
      }
      throw error;
    }
    const respondEffectiveProvider: AiTextProvider =
      provider === "custom" && respondTelemetry.fallback_used
        ? "anthropic"
        : provider;
    const respondEffectiveModel =
      respondEffectiveProvider === provider
        ? model
        : modelForProvider(c.env, respondEffectiveProvider);
    await writeAiEvent(c.env, {
      endpoint: "respond",
      provider: respondEffectiveProvider,
      originalProvider: provider,
      fallbackUsed: respondTelemetry.fallback_used === true,
      tier: access.tier,
      userId: access.user?.id ?? null,
      model: respondEffectiveModel,
      promptChars,
      responseChars: response.length,
      startedAt,
    });

    if (access.user) {
      const playerTag =
        parsed.data.player_tag ??
        (typeof parsed.data.playerData.tag === "string"
          ? parsed.data.playerData.tag
          : "unknown");
      await recordManagedAiAnalysis(c.env, c.req.header("Authorization"), {
        player_tag: playerTag,
        analysis_type:
          analysisScope === "deep" ? "deep_analysis" : parsed.data.type,
        prompt: parsed.data.prompt,
        result: response,
        model,
      });
    }

    return c.json({
      success: true,
      result: {
        response,
      },
    });
  } catch (error) {
    return jsonErrorFromException(c, error);
  }
});

// Schema for client-supplied cached weekly plans. Mirrors generateWeeklyPlan's
// return type. We validate before echoing back so the endpoint cannot be used
// to launder arbitrary content into a "plan" response — even after auth, the
// shape must match what the model would have produced.
const WeeklyPlanCacheSchema = z.object({
  coaching_summary: z.string(),
  performance_verdict: z.string(),
  confidence: z.string(),
  top_priority: z.object({
    title: z.string(),
    description: z.string(),
    evidence: z.string(),
    expected_impact: z.string(),
  }),
  weekly_goals: z.array(
    z.object({ goal: z.string(), metric: z.string(), how: z.string() }),
  ),
  drills: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      sessions_per_day: z.number(),
    }),
  ),
  deck_recommendation: z.object({
    verdict: z.string(),
    reasoning: z.string(),
    suggested_swap: z.string().nullable(),
  }),
  matchup_alerts: z.array(
    z.object({
      archetype: z.string(),
      win_rate: z.number(),
      tip: z.string(),
    }),
  ),
  tilt_note: z.string().nullable(),
  confidence_builders: z.array(z.string()),
});

app.post("/api/coach/weekly-plan/:tag", async (c) => {
  try {
    // Auth + Pro gate runs FIRST. The cache short-circuit below previously
    // ran before any check, which let anonymous callers get a 200 by POSTing
    // their own cached_plan — Pro entitlement bypass, fixed by ordering.
    const access = await getManagedAiAccess(
      c.env,
      c.req.header("Authorization"),
    );
    requireProAccess(access, "Upgrade to Pro to generate weekly plans.");

    const body = (await c.req.json().catch(() => ({}))) as {
      force_regenerate?: boolean;
      cached_plan?: unknown;
    };

    // Defense-in-depth: even an authenticated Pro user cannot launder
    // arbitrary JSON through this endpoint by labeling it cached_plan.
    if (!body.force_regenerate && body.cached_plan !== undefined) {
      const parsed = WeeklyPlanCacheSchema.safeParse(body.cached_plan);
      if (!parsed.success) {
        return jsonError(c, "Invalid cached_plan shape", 400);
      }
      return c.json({ plan: parsed.data, from_cache: true });
    }

    const { playerState } = await playerContext(
      c.env,
      c.req.param("tag"),
      c.get("requestId"),
    );
    const plan = await generateWeeklyPlan(c.env, playerState, {
      allowLiveModel: true,
    });
    return c.json({ plan, from_cache: false });
  } catch (error) {
    return jsonErrorFromException(c, error);
  }
});

app.post("/api/coach/question/:tag", async (c) => {
  const parsed = z
    .object({
      question: z.string().min(1),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(c, "Request body must include 'question'");
  }

  try {
    const access = await getManagedAiAccess(
      c.env,
      c.req.header("Authorization"),
    );
    requireProAccess(access, "Upgrade to Pro to use coach chat.");

    const { playerState } = await playerContext(
      c.env,
      c.req.param("tag"),
      c.get("requestId"),
    );
    const answer = await answerCoachQuestion(
      c.env,
      parsed.data.question,
      playerState,
      {
        allowLiveModel: true,
      },
    );
    return c.json({ answer });
  } catch (error) {
    return jsonErrorFromException(c, error);
  }
});

// --- Agentic coach chat (AG4) -------------------------------------------
//
// Streaming endpoint that runs the agent loop orchestrator from lib/agent.ts
// against the tool registry from lib/tools.ts. SSE response so the UI can
// render tool-call progress and a final answer without blocking on a
// single long round-trip. Thread persistence is in coach_threads /
// coach_messages (migration 006).
//
// Pro-only. Reuses Anthropic for the model tier. The 4th lane (custom
// garage model) will be layered in via a feature flag after Phase 2 of
// the custom-lane rollout produces evidence that Ollama tool-use is
// reliable enough (cr-9xm roadmap).
app.post("/api/coach/agent/:tag", async (c) => {
  const parsed = z
    .object({
      question: z.string().min(1).max(4000),
      thread_id: z.string().uuid().optional(),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(c, "Request body must include 'question'");
  }

  let access: ManagedAiAccess;
  try {
    access = await getManagedAiAccess(c.env, c.req.header("Authorization"));
    requireProAccess(access, "Upgrade to Pro to use agentic coach chat.");
    // AG7: per-user beta opt-in on top of the Pro check. Pro users
    // who have not toggled the flag get a 403 even if the master
    // VITE_COACH_AGENT_ENABLED flag is on. This lets us ramp the
    // beta to a small cohort without shipping a separate feature
    // flag service.
    if (!access.user) {
      throw new HttpError(401, "Unauthorized");
    }
    const optedIn = await readCoachAgentBetaOptIn(c.env, access.user.id);
    if (!optedIn) {
      throw new HttpError(
        403,
        "The agentic coach chat is in Pro beta. Enable it in your account settings to try it.",
        "forbidden_beta_optin_required",
      );
    }
  } catch (error) {
    return jsonErrorFromException(c, error);
  }

  const authorization = c.req.header("Authorization");
  const playerTag = normalizeTag(c.req.param("tag"));
  const requestId = c.get("requestId");

  // Resolve or create the thread. Invalid thread_id (not owned by user
  // or non-existent) is treated as "create new" rather than 404 — this
  // matches common chat-UX expectations and avoids leaking thread
  // ownership to a probing client.
  let threadId: string;
  let history: ReturnType<typeof messageRecordToAnthropic>[] = [];
  try {
    if (parsed.data.thread_id) {
      const existing = await getCoachThread(
        c.env,
        authorization,
        parsed.data.thread_id,
      );
      if (existing) {
        threadId = existing.id;
        const messages = await listCoachMessages(
          c.env,
          authorization,
          threadId,
        );
        history = messages.map(messageRecordToAnthropic);
      } else {
        const fresh = await createCoachThread(c.env, authorization, {
          player_tag: playerTag,
        });
        threadId = fresh.id;
      }
    } else {
      const fresh = await createCoachThread(c.env, authorization, {
        player_tag: playerTag,
      });
      threadId = fresh.id;
    }
  } catch (error) {
    return jsonErrorFromException(c, error);
  }

  const userMessage = parsed.data.question;
  const userTag = access.user?.id ?? null;
  const startedAt = Date.now();

  // Persist the user's turn before starting the generator so that even
  // if the agent loop crashes mid-stream, the thread has the prompt.
  try {
    await appendCoachMessage(c.env, authorization, {
      thread_id: threadId,
      role: "user",
      content: userMessage,
    });
  } catch (error) {
    return jsonErrorFromException(c, error);
  }

  const encoder = new TextEncoder();

  function sseFrame(event: string, data: unknown): Uint8Array {
    return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  // AbortController is attached to the response stream's cancel handler
  // so a client disconnect propagates into the agent loop and the
  // Anthropic fetch is cancelled. Prevents orphan LLM spend.
  const abortController = new AbortController();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      // Open with thread metadata so the client can persist it in URL
      // state for resume.
      controller.enqueue(
        sseFrame("thread", { thread_id: threadId, player_tag: playerTag }),
      );

      const generator = runAgentTurn({
        env: c.env,
        playerTag,
        requestId,
        userMessage,
        history,
        signal: abortController.signal,
        onTelemetry: (event) => {
          // Tool-call telemetry. Fires once per tool dispatch. Indexed on
          // endpoint + tier + tool name so ops can slice per tool.
          if (!c.env.AI_EVENTS) return;
          try {
            c.env.AI_EVENTS.writeDataPoint({
              indexes: ["coach_agent_tool", access.tier, event.toolName],
              blobs: [
                playerTag,
                userTag ?? "anonymous",
                event.isError ? "error" : "ok",
              ],
              doubles: [event.latencyMs, event.turn, event.isError ? 1 : 0],
            });
          } catch {
            // Telemetry must never fail the stream.
          }
        },
      });

      let finalText = "";
      let finalMessages: ReturnType<typeof messageRecordToAnthropic>[] = [];
      let errored = false;

      try {
        for await (const event of generator) {
          controller.enqueue(sseFrame(event.type, event));
          if (event.type === "final") {
            finalText = event.text;
            finalMessages = event.messages;
          } else if (event.type === "error") {
            errored = true;
          }
        }
      } catch (error) {
        // Generator threw — shouldn't happen (runAgentTurn yields
        // errors rather than throwing) but be defensive.
        errored = true;
        controller.enqueue(
          sseFrame("error", {
            type: "error",
            reason: "anthropic_error",
            detail: error instanceof Error ? error.message : "unknown",
          }),
        );
      }

      // Persist the assistant's final message + any tool_use/tool_result
      // turns that happened in between. The orchestrator's `messages`
      // array already carries them in Anthropic content-block form.
      if (!errored && finalMessages.length > 0) {
        // The last assistant message is the one we just produced.
        const toPersist = finalMessages.slice(history.length + 1);
        for (const message of toPersist) {
          try {
            await appendCoachMessage(c.env, authorization, {
              thread_id: threadId,
              role: message.role,
              content: message.content,
            });
          } catch {
            // A persistence failure here is annoying but not fatal —
            // the client already has the stream. Log via the event
            // rather than dropping to Sentry synchronously.
          }
        }
      }

      // One last telemetry row for the overall turn.
      if (c.env.AI_EVENTS) {
        try {
          c.env.AI_EVENTS.writeDataPoint({
            indexes: [
              "coach_agent_turn",
              access.tier,
              errored ? "error" : "ok",
            ],
            blobs: [playerTag, userTag ?? "anonymous", threadId],
            doubles: [
              Date.now() - startedAt,
              finalText.length,
              errored ? 1 : 0,
            ],
          });
        } catch {
          /* telemetry best-effort */
        }
      }

      controller.close();
    },
    cancel() {
      abortController.abort();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-store",
      "x-accel-buffering": "no",
      connection: "keep-alive",
    },
  });
});

app.post("/api/payments/checkout", async (c) => {
  const parsed = z
    .object({
      user_email: z.string().email(),
      user_id: z.string().min(1),
    })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(c, "Request body must include user_email and user_id");
  }

  const user = await getAuthenticatedUser(c.env, c.req.header("Authorization"));
  if (!user || user.id !== parsed.data.user_id) {
    return jsonError(c, "Unauthorized", 401);
  }

  const checkout = await createCheckoutUrl(
    c.env,
    user.email ?? parsed.data.user_email,
    user.id,
  );
  return c.json(checkout);
});

app.get("/api/payments/subscription/:userId", async (c) => {
  try {
    const status = await getSubscriptionStatus(
      c.env,
      c.req.header("Authorization"),
      c.req.param("userId"),
    );
    return c.json(status);
  } catch (error) {
    return jsonErrorFromException(c, error);
  }
});

app.post("/api/payments/webhook", async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header("X-Signature");
  if (
    !(await verifyWebhookSignature(
      c.env.LEMONSQUEEZY_WEBHOOK_SECRET,
      rawBody,
      signature,
    ))
  ) {
    return jsonError(c, "Invalid webhook signature", 401);
  }

  const parsed = lemonWebhookPayloadSchema.safeParse(
    (() => {
      try {
        return JSON.parse(rawBody) as unknown;
      } catch {
        return null;
      }
    })(),
  );

  if (!parsed.success) {
    return jsonError(c, "Invalid webhook payload", 400);
  }

  const userId = parsed.data.meta.custom_data.user_id;
  const status = parsed.data.data.attributes.status;
  const tier = mapSubscriptionStatusToTier(status);

  const recordResult = await tryRecordSubscriptionWebhookEvent(c.env, rawBody, {
    user_id: userId,
    subscription_id: parsed.data.data.id,
    subscription_status: status,
    subscription_tier: tier,
    payload: parsed.data,
  });

  if (recordResult !== "duplicate") {
    await applySubscriptionUpdate(c.env, {
      user_id: userId,
      subscription_id: parsed.data.data.id,
      subscription_status: status,
      subscription_tier: tier,
    });
  }

  return c.json({ ok: true });
});

app.get("/api/tracked-players", async (c) => {
  try {
    const trackedPlayers = await listTrackedPlayers(
      c.env,
      c.req.header("Authorization"),
    );
    return c.json(trackedPlayers);
  } catch (error) {
    return jsonErrorFromException(c, error);
  }
});

app.delete("/api/tracked-players/:id", async (c) => {
  try {
    await deleteTrackedPlayer(
      c.env,
      c.req.header("Authorization"),
      c.req.param("id"),
    );
    return c.json({ ok: true });
  } catch (error) {
    return jsonErrorFromException(c, error);
  }
});

app.get("/api/analysis-history", async (c) => {
  const query = c.req.query();
  const limit = Number.parseInt(query.limit ?? "20", 10);

  try {
    const records = await listAnalysisHistory(
      c.env,
      c.req.header("Authorization"),
      {
        playerTag: query.player_tag,
        limit: Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 100) : 20,
      },
    );
    return c.json(records);
  } catch (error) {
    return jsonErrorFromException(c, error);
  }
});

app.post("/api/analysis-history", async (c) => {
  const parsed = z
    .object({
      player_tag: z.string().min(1),
      analysis_type: z.string().min(1),
      prompt: z.string().optional(),
      result: z.string().min(1),
      model: z.string().optional(),
    })
    .safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) {
    return jsonError(
      c,
      "Request body must include player_tag, analysis_type, and result",
    );
  }

  try {
    const record = await createAnalysisHistory(
      c.env,
      c.req.header("Authorization"),
      parsed.data,
    );
    return c.json(record);
  } catch (error) {
    return jsonErrorFromException(c, error);
  }
});

app.get("/api/gdpr/settings", async (c) => {
  try {
    const settings = await getPrivacySettings(
      c.env,
      c.req.header("Authorization"),
    );
    return c.json(settings);
  } catch (error) {
    return jsonErrorFromException(c, error);
  }
});

app.put("/api/gdpr/settings", async (c) => {
  const parsed = z
    .object({
      data_retention_days: z
        .union([z.literal(30), z.literal(90), z.literal(365)])
        .optional(),
      privacy_policy_version: z.string().trim().min(1).optional(),
      acknowledge_privacy_policy: z.boolean().optional(),
      acknowledge_byok_local_storage_notice: z.boolean().optional(),
    })
    .safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) {
    return jsonError(
      c,
      "Request body must include valid privacy settings such as retention days or acknowledgements",
    );
  }

  try {
    const settings = await updatePrivacySettings(
      c.env,
      c.req.header("Authorization"),
      parsed.data,
    );
    return c.json(settings);
  } catch (error) {
    return jsonErrorFromException(c, error);
  }
});

// --- Agent beta opt-in (AG7) --------------------------------------------
//
// Pro users toggle this to gain access to the experimental agentic coach
// chat. The /api/coach/agent endpoint checks the flag server-side; this
// endpoint exists so the web UI can read/write it.
app.get("/api/coach/agent-beta", async (c) => {
  try {
    const access = await getManagedAiAccess(
      c.env,
      c.req.header("Authorization"),
    );
    if (!access.user) {
      throw new HttpError(401, "Unauthorized");
    }
    const optedIn = await readCoachAgentBetaOptIn(c.env, access.user.id);
    return c.json({
      opted_in: optedIn,
      eligible: access.tier === "pro",
    });
  } catch (error) {
    return jsonErrorFromException(c, error);
  }
});

app.put("/api/coach/agent-beta", async (c) => {
  const parsed = z
    .object({ opted_in: z.boolean() })
    .safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return jsonError(c, "Request body must include 'opted_in' (boolean)");
  }
  try {
    const access = await getManagedAiAccess(
      c.env,
      c.req.header("Authorization"),
    );
    // Only Pro users can flip the flag — there's no point letting a free
    // user opt in to a Pro-only feature. We'd surface it but the route
    // guard would still reject their requests.
    requireProAccess(
      access,
      "Upgrade to Pro before enabling the agentic coach chat beta.",
    );
    const value = await setCoachAgentBetaOptIn(
      c.env,
      c.req.header("Authorization"),
      parsed.data.opted_in,
    );
    return c.json({ opted_in: value });
  } catch (error) {
    return jsonErrorFromException(c, error);
  }
});

app.get("/api/gdpr/export", async (c) => {
  try {
    const payload = await exportUserData(c.env, c.req.header("Authorization"));
    return c.json(payload, 200, {
      "Content-Disposition": `attachment; filename="declaw-export-${payload.user.id}.json"`,
    });
  } catch (error) {
    return jsonErrorFromException(c, error);
  }
});

app.post("/api/gdpr/erase", async (c) => {
  const parsed = z
    .object({
      confirmation: z.literal("ERASE"),
    })
    .safeParse(await c.req.json().catch(() => null));

  if (!parsed.success) {
    return jsonError(c, "Request body must include confirmation: 'ERASE'");
  }

  try {
    await eraseUserData(c.env, c.req.header("Authorization"));
    return c.json({ ok: true });
  } catch (error) {
    return jsonErrorFromException(c, error);
  }
});

app.onError((error, c) => {
  const requestId = c.get("requestId") ?? crypto.randomUUID();
  const status = statusForError(error);
  const code = inferErrorCode(error, status);
  const message = publicMessageFor(error);
  logRedactedError(requestId, error, message);
  return apiErrorResponse(requestId, code, message, status);
});

export default {
  fetch(request: Request, env: Env) {
    return app.fetch(request, env);
  },
};

export { app };
