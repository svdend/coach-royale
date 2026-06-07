/**
 * @fileoverview Pure provider-routing logic.
 *
 * Extracted from index.ts so it is trivially testable in isolation without
 * bringing up the whole Hono app. Contains no side effects — every function
 * is a pure transformation from (env, access) to a provider/model name.
 *
 * Phase 1 of the 4th AI lane (operator-only custom provider) uses
 * providerForAccess() as the gate. Subsequent phases (user opt-in flag,
 * Pro+ tier) will extend the gate in this file rather than in index.ts.
 */

import type { AiTextProvider } from "./ai";
import type { Env } from "../types";

/** Parses env.OPERATOR_USER_IDS into a Set. Empty/undefined returns an empty Set. */
export function parseOperatorIds(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  return new Set(
    raw
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  );
}

export function isOperator(
  env: Env,
  userId: string | null | undefined,
): boolean {
  if (!userId) return false;
  const operators = parseOperatorIds(env.OPERATOR_USER_IDS);
  return operators.has(userId);
}

/**
 * Returns true when the custom (self-hosted) lane has enough config to be
 * callable. Used to avoid routing to a broken lane — if the env is missing
 * URL / key / name, providerForAccess will skip the custom branch.
 */
export function customLaneConfigured(env: Env): boolean {
  return Boolean(
    env.CUSTOM_MODEL_URL && env.CUSTOM_MODEL_KEY && env.CUSTOM_MODEL_NAME,
  );
}

export interface AccessContext {
  user: { id: string } | null;
  tier: "free" | "pro";
}

/**
 * Selects the managed AI provider for a given authenticated session.
 *
 * Priority (Phase 1):
 *   1. No user  -> "deterministic"
 *   2. User is in OPERATOR_USER_IDS AND custom lane is configured -> "custom"
 *   3. tier === "pro" -> "anthropic"
 *   4. tier === "free" -> "workers_ai"
 */
export function providerForAccess(
  access: AccessContext,
  env: Env,
): AiTextProvider {
  if (!access.user) {
    return "deterministic";
  }

  if (isOperator(env, access.user.id) && customLaneConfigured(env)) {
    return "custom";
  }

  return access.tier === "pro" ? "anthropic" : "workers_ai";
}

export function modelForProvider(env: Env, provider: AiTextProvider): string {
  if (provider === "workers_ai") {
    return env.WORKERS_AI_MODEL?.trim() || "@cf/openai/gpt-oss-20b";
  }

  if (provider === "anthropic") {
    return env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-20250514";
  }

  if (provider === "custom") {
    return env.CUSTOM_MODEL_NAME?.trim() || "custom-unknown";
  }

  return "deterministic-fallback";
}
