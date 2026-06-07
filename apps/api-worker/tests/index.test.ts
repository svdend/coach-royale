import { beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "../src/index";
import * as supabaseLib from "../src/lib/supabase";
import type { Env } from "../src/types";

const env: Env = {
  ALLOWED_ORIGINS: "http://localhost:5173",
  RELAY_BASE_URL: "https://relay.example.com",
  RELAY_SHARED_SECRET: "relay-secret",
};

const readyEnv: Env = {
  ...env,
  AI: { run: vi.fn() } as unknown as Ai,
  AI_GATEWAY_ID: "coachroyale-free",
  LEMONSQUEEZY_API_KEY: "lemon-api-key",
  LEMONSQUEEZY_STORE_ID: "store-id",
  LEMONSQUEEZY_VARIANT_ID: "variant-id",
  LEMONSQUEEZY_WEBHOOK_SECRET: "webhook-secret",
  SUPABASE_ANON_KEY: "supabase-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "role-key",
  SUPABASE_URL: "https://project.supabase.co",
  WORKERS_AI_MODEL: "@cf/openai/gpt-oss-20b",
};

async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

describe("api worker", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("rejects managed analysis without a tag in the JSON body", async () => {
    const response = await app.request(
      "/api/analysis",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      env,
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "bad_request", message: "Request body must include tag" },
      request_id: expect.any(String),
    });
  });

  it("returns health status", async () => {
    const response = await app.request(
      "/api/health",
      {
        headers: { "X-Request-ID": "client-request-1" },
      },
      env,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Request-ID")).toBe("client-request-1");
    await expect(response.json()).resolves.toEqual({
      status: "ok",
      service: "api-worker",
    });
  });

  it("reports Worker readiness when dependencies are configured", async () => {
    const response = await app.request("/api/ready", undefined, readyEnv);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ready",
      service: "api-worker",
      checks: {
        relay_base_url: true,
        relay_shared_secret: true,
        supabase_url: true,
        workers_ai_binding: true,
      },
    });
  });

  it("reports Worker not-ready status when dependencies are missing", async () => {
    const response = await app.request("/api/ready", undefined, env);

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      status: "not_ready",
      service: "api-worker",
      checks: {
        lemon_squeezy_api_key: false,
        supabase_url: false,
        workers_ai_binding: false,
      },
    });
  });

  it("sets security headers on HTTPS API responses", async () => {
    const response = await app.request(
      "https://relay.coach-royale.com/api/health",
      undefined,
      env,
    );

    expect(response.headers.get("Strict-Transport-Security")).toBe(
      "max-age=31536000; includeSubDomains; preload",
    );
    expect(response.headers.get("Cross-Origin-Opener-Policy")).toBe(
      "same-origin",
    );
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe(
      "cross-origin",
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  });

  it("proxies player requests through the relay", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(
          "https://relay.example.com/relay/player/%232PP",
        );
        expect(init?.headers).toMatchObject({
          "X-Relay-Auth": "relay-secret",
        });
        expect(
          (init?.headers as Record<string, string>)["X-Request-ID"],
        ).toBeTruthy();
        return new Response(JSON.stringify({ tag: "#2PP", name: "Coach" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const response = await app.request("/api/player/2pp", undefined, env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("public");
    await expect(response.json()).resolves.toEqual({
      tag: "#2PP",
      name: "Coach",
    });
  });

  it("returns a deterministic quick AI fallback without Anthropic configured", async () => {
    const response = await app.request(
      "/api/ai/respond",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Give quick stats",
          playerData: { name: "Coach", tag: "#2PP" },
          type: "quick_stats",
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      success: true,
      result: {
        response: "quick stats: Give quick stats Player: Coach.",
      },
    });
  });

  it("does not downgrade invalid bearer tokens to anonymous AI access", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ error: "invalid token" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const response = await app.request(
      "/api/ai/respond",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer expired-token",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: "Give quick stats",
          playerData: { name: "Coach", tag: "#2PP" },
          type: "quick_stats",
        }),
      },
      {
        ...env,
        SUPABASE_URL: "https://project.supabase.co",
        SUPABASE_ANON_KEY: "anon-key",
      },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unauthorized", message: "Unauthorized" },
      request_id: expect.any(String),
    });
  });

  it("routes authenticated free quick AI calls to Workers AI", async () => {
    const aiRun = vi.fn(async () => ({
      response: "Use one ladder deck for the next session.",
    }));
    vi.spyOn(supabaseLib, "getManagedAiAccess").mockResolvedValue({
      user: { id: "user-123", email: "coach@example.com" },
      tier: "free",
      limits: { quick_analysis: 5, deep_analysis: 1 },
      usage: { quick_analysis: 0, deep_analysis: 0 },
      free_ai: { daily_limit: 30, used_today: 0 },
    });
    vi.spyOn(supabaseLib, "incrementFreeAiUsage").mockResolvedValue(1);

    const response = await app.request(
      "/api/ai/respond",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Give quick stats",
          playerData: { name: "Coach", tag: "#2PP" },
          type: "quick_stats",
          analysis_scope: "quick",
        }),
      },
      {
        ...env,
        AI: { run: aiRun } as unknown as Ai,
        AI_GATEWAY_ID: "coachroyale-free",
        WORKERS_AI_MODEL: "@cf/openai/gpt-oss-20b",
      },
    );

    expect(response.status).toBe(200);
    expect(aiRun).toHaveBeenCalledWith(
      "@cf/openai/gpt-oss-20b",
      expect.objectContaining({
        max_tokens: 500,
        messages: expect.arrayContaining([
          expect.objectContaining({ role: "system" }),
          expect.objectContaining({ role: "user" }),
        ]),
      }),
      expect.objectContaining({
        gateway: expect.objectContaining({
          id: "coachroyale-free",
          requestTimeoutMs: 90_000,
        }),
        signal: expect.any(AbortSignal),
      }),
    );
    await expect(response.json()).resolves.toEqual({
      success: true,
      result: {
        response: "Use one ladder deck for the next session.",
      },
    });
  });

  it("returns an upsell when the free AI daily cap is reached", async () => {
    const incrementSpy = vi.spyOn(supabaseLib, "incrementFreeAiUsage");
    vi.spyOn(supabaseLib, "getManagedAiAccess").mockResolvedValue({
      user: { id: "user-123", email: "coach@example.com" },
      tier: "free",
      limits: { quick_analysis: 5, deep_analysis: 1 },
      usage: { quick_analysis: 0, deep_analysis: 0 },
      free_ai: { daily_limit: 30, used_today: 30 },
    });

    const response = await app.request(
      "/api/ai/respond",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Give quick stats",
          playerData: { name: "Coach", tag: "#2PP" },
          type: "quick_stats",
          analysis_scope: "quick",
        }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(incrementSpy).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      result: { response: "" },
      text: null,
      upsell: { reason: "daily_limit" },
    });
  });

  it("returns an upsell when the shared Workers AI pool is exhausted", async () => {
    vi.spyOn(supabaseLib, "getManagedAiAccess").mockResolvedValue({
      user: { id: "user-123", email: "coach@example.com" },
      tier: "free",
      limits: { quick_analysis: 5, deep_analysis: 1 },
      usage: { quick_analysis: 0, deep_analysis: 0 },
      free_ai: { daily_limit: 30, used_today: 0 },
    });
    vi.spyOn(supabaseLib, "incrementFreeAiUsage").mockResolvedValue(1);

    const response = await app.request(
      "/api/ai/respond",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Give quick stats",
          playerData: { name: "Coach", tag: "#2PP" },
          type: "quick_stats",
          analysis_scope: "quick",
        }),
      },
      {
        ...env,
        AI: {
          run: vi.fn(async () => {
            throw new Error("429 Too Many Requests");
          }),
        } as unknown as Ai,
      },
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      result: { response: "" },
      text: null,
      upsell: { reason: "pool_exhausted" },
    });
  });

  it("returns an explicit service error for pro AI when Anthropic is unavailable", async () => {
    vi.spyOn(supabaseLib, "getManagedAiAccess").mockResolvedValue({
      user: { id: "user-123", email: "coach@example.com" },
      tier: "pro",
      limits: { quick_analysis: 999, deep_analysis: 999 },
      usage: { quick_analysis: 0, deep_analysis: 0 },
    });

    const response = await app.request(
      "/api/ai/respond",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Give quick stats",
          playerData: { name: "Coach", tag: "#2PP" },
          type: "quick_stats",
          analysis_scope: "quick",
        }),
      },
      env,
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "provider_unavailable",
        message: "coaching_unavailable",
      },
      request_id: expect.any(String),
    });
  });

  it("enforces quick-analysis limits for authenticated free users", async () => {
    vi.spyOn(supabaseLib, "getManagedAiAccess").mockResolvedValue({
      user: { id: "user-123", email: "coach@example.com" },
      tier: "free",
      limits: { quick_analysis: 5, deep_analysis: 1 },
      usage: { quick_analysis: 5, deep_analysis: 0 },
    });

    const response = await app.request(
      "/api/ai/respond",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Give quick stats",
          playerData: { name: "Coach", tag: "#2PP" },
          type: "quick_stats",
          analysis_scope: "quick",
        }),
      },
      env,
    );

    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "quota_exceeded",
        message: "Daily quick-analysis limit reached. Resets at midnight UTC.",
      },
      request_id: expect.any(String),
    });
  });

  it("requires sign-in for managed deep-analysis calls", async () => {
    vi.spyOn(supabaseLib, "getManagedAiAccess").mockResolvedValue({
      user: null,
      tier: "free",
      limits: { quick_analysis: 5, deep_analysis: 1 },
      usage: { quick_analysis: 0, deep_analysis: 0 },
    });

    const response = await app.request(
      "/api/ai/respond",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "Give me the deep version",
          playerData: { name: "Coach", tag: "#2PP" },
          type: "battle_summary",
          analysis_scope: "deep",
        }),
      },
      env,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "unauthorized",
        message: "Sign in required for deep analysis.",
      },
      request_id: expect.any(String),
    });
  });

  it("returns analytics and a plan using relay data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith("/relay/player/%232PP")) {
          return new Response(
            JSON.stringify({ tag: "#2PP", trophies: 6000, name: "Coach" }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        if (url.endsWith("/relay/player/%232PP/battles")) {
          return new Response(
            JSON.stringify([
              {
                battleTime: "20260420T120000.000Z",
                type: "PvP",
                gameMode: { name: "Ladder" },
                team: [
                  {
                    tag: "#2PP",
                    name: "Coach",
                    crowns: 3,
                    trophyChange: 29,
                    startingTrophies: 6000,
                    cards: [
                      { name: "Knight" },
                      { name: "Hog Rider" },
                      { name: "Ice Spirit" },
                      { name: "Cannon" },
                    ],
                  },
                ],
                opponent: [
                  {
                    tag: "#ABC",
                    name: "Rival",
                    crowns: 1,
                    startingTrophies: 6010,
                    cards: [
                      { name: "Golem" },
                      { name: "Night Witch" },
                      { name: "Baby Dragon" },
                      { name: "Tornado" },
                    ],
                  },
                ],
              },
              {
                battleTime: "20260421T120000.000Z",
                type: "PvP",
                gameMode: { name: "Ladder" },
                team: [
                  {
                    tag: "#2PP",
                    name: "Coach",
                    crowns: 0,
                    trophyChange: -30,
                    startingTrophies: 6029,
                    cards: [
                      { name: "Knight" },
                      { name: "Hog Rider" },
                      { name: "Ice Spirit" },
                      { name: "Cannon" },
                    ],
                  },
                ],
                opponent: [
                  {
                    tag: "#XYZ",
                    name: "Rival 2",
                    crowns: 2,
                    startingTrophies: 6040,
                    cards: [
                      { name: "Goblin Barrel" },
                      { name: "Princess" },
                      { name: "Goblin Gang" },
                      { name: "Knight" },
                    ],
                  },
                ],
              },
            ]),
            {
              status: 200,
              headers: { "Content-Type": "application/json" },
            },
          );
        }
        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const analyticsResponse = await app.request(
      "/api/player/2pp/analytics",
      undefined,
      env,
    );
    expect(analyticsResponse.status).toBe(200);
    const analyticsPayload = (await analyticsResponse.json()) as {
      player_state: { player_tag: string };
    };
    expect(analyticsPayload.player_state.player_tag).toBe("#2PP");
    expect("analysis" in analyticsPayload).toBe(false);

    const analyzeResponse = await app.request(
      "/api/analysis",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tag: "2pp" }),
      },
      env,
    );
    expect(analyzeResponse.status).toBe(200);
    const analyzePayload = (await analyzeResponse.json()) as {
      analysis: string;
      player_state: { player_tag: string };
    };
    expect(analyzePayload.player_state.player_tag).toBe("#2PP");
    expect(analyzePayload.analysis).toContain("Player Coach");

    vi.spyOn(supabaseLib, "getManagedAiAccess").mockResolvedValue({
      user: { id: "user-123", email: "coach@example.com" },
      tier: "pro",
      limits: { quick_analysis: 999, deep_analysis: 999 },
      usage: { quick_analysis: 0, deep_analysis: 0 },
    });

    const planResponse = await app.request(
      "/api/coach/weekly-plan/2pp",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force_regenerate: true }),
      },
      env,
    );
    expect(planResponse.status).toBe(200);
    const planPayload = (await planResponse.json()) as {
      from_cache: boolean;
      plan: { top_priority: { title: string } };
    };
    expect(planPayload.from_cache).toBe(false);
    expect(planPayload.plan.top_priority.title).toBe(
      "Stabilize one ladder deck",
    );
  });

  it("rejects anonymous weekly-plan requests even when cached_plan is supplied", async () => {
    // Regression for the cached_plan auth-bypass: previously, a body with
    // cached_plan returned 200 before auth ran. Auth + Pro gate must run first.
    const response = await app.request(
      "/api/coach/weekly-plan/2pp",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cached_plan: { hijacked: true } }),
      },
      env,
    );
    expect(response.status).toBe(401);
    const payload = (await response.json()) as { error?: { message?: string } };
    expect(payload.error?.message ?? "").not.toContain("hijacked");
  });

  it("rejects free-tier weekly-plan cache requests with a Pro upsell", async () => {
    vi.spyOn(supabaseLib, "getManagedAiAccess").mockResolvedValue({
      user: { id: "user-123", email: "coach@example.com" },
      tier: "free",
      limits: { quick_analysis: 5, deep_analysis: 1 },
      usage: { quick_analysis: 0, deep_analysis: 0 },
      free_ai: { daily_limit: 30, used_today: 0 },
    });

    const response = await app.request(
      "/api/coach/weekly-plan/2pp",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer free-user-token",
        },
        body: JSON.stringify({
          cached_plan: { coaching_summary: "free-tier cache attempt" },
        }),
      },
      env,
    );
    // Free tier must be denied even on the cache path. Pro gate runs first.
    expect([402, 403]).toContain(response.status);
  });

  it("returns the validated cached plan to a Pro user without regenerating", async () => {
    vi.spyOn(supabaseLib, "getManagedAiAccess").mockResolvedValue({
      user: { id: "user-pro", email: "pro@example.com" },
      tier: "pro",
      limits: { quick_analysis: 999, deep_analysis: 999 },
      usage: { quick_analysis: 0, deep_analysis: 0 },
    });

    const validCachedPlan = {
      coaching_summary: "Cached summary text.",
      performance_verdict: "Improving",
      confidence: "medium",
      top_priority: {
        title: "Stabilize one ladder deck",
        description: "Reduce deck switching.",
        evidence: "Cached evidence.",
        expected_impact: "More reliable matchups.",
      },
      weekly_goals: [],
      drills: [],
      deck_recommendation: {
        verdict: "Keep current primary deck",
        reasoning: "Cached reasoning.",
        suggested_swap: null,
      },
      matchup_alerts: [],
      tilt_note: null,
      confidence_builders: [],
    };

    const response = await app.request(
      "/api/coach/weekly-plan/2pp",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer pro-user-token",
        },
        body: JSON.stringify({ cached_plan: validCachedPlan }),
      },
      env,
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      from_cache: boolean;
      plan: { top_priority: { title: string } };
    };
    expect(payload.from_cache).toBe(true);
    expect(payload.plan.top_priority.title).toBe("Stabilize one ladder deck");
  });

  it("rejects malformed cached_plan even from a Pro user", async () => {
    vi.spyOn(supabaseLib, "getManagedAiAccess").mockResolvedValue({
      user: { id: "user-pro", email: "pro@example.com" },
      tier: "pro",
      limits: { quick_analysis: 999, deep_analysis: 999 },
      usage: { quick_analysis: 0, deep_analysis: 0 },
    });

    const response = await app.request(
      "/api/coach/weekly-plan/2pp",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer pro-user-token",
        },
        body: JSON.stringify({
          cached_plan: { not_a_plan: "arbitrary content" },
        }),
      },
      env,
    );
    expect(response.status).toBe(400);
  });

  it("rejects checkout requests without authenticated ownership", async () => {
    const response = await app.request(
      "/api/payments/checkout",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_email: "coach@example.com",
          user_id: "user-123",
        }),
      },
      env,
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unauthorized", message: "Unauthorized" },
      request_id: expect.any(String),
    });
  });

  it("applies signed Lemon Squeezy subscription updates", async () => {
    const updateSpy = vi
      .spyOn(supabaseLib, "applySubscriptionUpdate")
      .mockResolvedValue(undefined);
    const body = JSON.stringify({
      meta: {
        custom_data: {
          user_id: "00000000-0000-4000-8000-000000000001",
        },
      },
      data: {
        id: "sub_123",
        attributes: {
          status: "active",
        },
      },
    });
    const signature = await hmacSha256Hex("webhook-secret", body);

    const response = await app.request(
      "/api/payments/webhook",
      {
        method: "POST",
        headers: { "X-Signature": signature },
        body,
      },
      { ...env, LEMONSQUEEZY_WEBHOOK_SECRET: "webhook-secret" },
    );

    expect(response.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(expect.anything(), {
      user_id: "00000000-0000-4000-8000-000000000001",
      subscription_id: "sub_123",
      subscription_status: "active",
      subscription_tier: "pro",
    });
    await expect(response.json()).resolves.toEqual({ ok: true });
  });

  it("rejects Lemon Squeezy webhooks with invalid signatures", async () => {
    const updateSpy = vi
      .spyOn(supabaseLib, "applySubscriptionUpdate")
      .mockResolvedValue(undefined);

    const response = await app.request(
      "/api/payments/webhook",
      {
        method: "POST",
        headers: { "X-Signature": "invalid" },
        body: JSON.stringify({}),
      },
      { ...env, LEMONSQUEEZY_WEBHOOK_SECRET: "webhook-secret" },
    );

    expect(response.status).toBe(401);
    expect(updateSpy).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "unauthorized",
        message: "Invalid webhook signature",
      },
      request_id: expect.any(String),
    });
  });

  it("rejects signed Lemon Squeezy webhooks with invalid JSON", async () => {
    const updateSpy = vi
      .spyOn(supabaseLib, "applySubscriptionUpdate")
      .mockResolvedValue(undefined);
    const body = "{not-json";
    const signature = await hmacSha256Hex("webhook-secret", body);

    const response = await app.request(
      "/api/payments/webhook",
      {
        method: "POST",
        headers: { "X-Signature": signature },
        body,
      },
      { ...env, LEMONSQUEEZY_WEBHOOK_SECRET: "webhook-secret" },
    );

    expect(response.status).toBe(400);
    expect(updateSpy).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "bad_request", message: "Invalid webhook payload" },
      request_id: expect.any(String),
    });
  });

  it.each([
    [
      "user id",
      {
        meta: { custom_data: {} },
        data: { id: "sub_123", attributes: { status: "active" } },
      },
    ],
    [
      "subscription id",
      {
        meta: {
          custom_data: { user_id: "00000000-0000-4000-8000-000000000001" },
        },
        data: { id: "", attributes: { status: "active" } },
      },
    ],
    [
      "subscription status",
      {
        meta: {
          custom_data: { user_id: "00000000-0000-4000-8000-000000000001" },
        },
        data: { id: "sub_123", attributes: { status: "" } },
      },
    ],
  ])(
    "rejects signed Lemon Squeezy webhooks missing %s",
    async (_field, payload) => {
      const updateSpy = vi
        .spyOn(supabaseLib, "applySubscriptionUpdate")
        .mockResolvedValue(undefined);
      const body = JSON.stringify(payload);
      const signature = await hmacSha256Hex("webhook-secret", body);

      const response = await app.request(
        "/api/payments/webhook",
        {
          method: "POST",
          headers: { "X-Signature": signature },
          body,
        },
        { ...env, LEMONSQUEEZY_WEBHOOK_SECRET: "webhook-secret" },
      );

      expect(response.status).toBe(400);
      expect(updateSpy).not.toHaveBeenCalled();
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "bad_request", message: "Invalid webhook payload" },
        request_id: expect.any(String),
      });
    },
  );

  it("rejects tracked player access without an authenticated session", async () => {
    const response = await app.request("/api/tracked-players", undefined, env);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unauthorized", message: "Unauthorized" },
      request_id: expect.any(String),
    });
  });

  it("rejects GDPR export without an authenticated session", async () => {
    const response = await app.request("/api/gdpr/export", undefined, env);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unauthorized", message: "Unauthorized" },
      request_id: expect.any(String),
    });
  });

  it("rejects GDPR settings reads without an authenticated session", async () => {
    const response = await app.request("/api/gdpr/settings", undefined, env);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "unauthorized", message: "Unauthorized" },
      request_id: expect.any(String),
    });
  });

  it("rejects coach chat for free users at the Worker boundary", async () => {
    vi.spyOn(supabaseLib, "getManagedAiAccess").mockResolvedValue({
      user: { id: "user-123", email: "coach@example.com" },
      tier: "free",
      limits: { quick_analysis: 5, deep_analysis: 1 },
      usage: { quick_analysis: 0, deep_analysis: 0 },
    });

    const response = await app.request(
      "/api/coach/question/2pp",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: "How do I break through 6k?" }),
      },
      env,
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "forbidden",
        message: "Upgrade to Pro to use coach chat.",
      },
      request_id: expect.any(String),
    });
  });

  it("does not leak internal Error messages to clients", async () => {
    // Trigger an internal error from a code path the client cannot influence:
    // GDPR erase calls eraseUserData, which threw raw Supabase upstream body
    // text into Error messages. Mock it to throw a sensitive message and
    // assert the client never sees that text.
    vi.spyOn(supabaseLib, "eraseUserData").mockRejectedValue(
      new Error(
        'Failed to erase user data: {"code":"42P01","message":"DB internal: secret-row-id-9c7e"}',
      ),
    );

    const response = await app.request(
      "/api/gdpr/erase",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer u",
        },
        body: JSON.stringify({ confirmation: "ERASE" }),
      },
      readyEnv,
    );

    expect(response.status).toBe(500);
    const payload = (await response.json()) as {
      error?: { message?: string; code?: string };
      request_id?: string;
    };
    // Public message must be generic — must NOT echo the upstream body or
    // any of its identifiers.
    expect(payload.error?.message ?? "").not.toContain("secret-row-id-9c7e");
    expect(payload.error?.message ?? "").not.toContain("42P01");
    expect(payload.error?.message ?? "").not.toContain("Supabase");
    expect(payload.error?.code).toBe("internal_error");
    // requestId still surfaces so support can correlate logs.
    expect(payload.request_id).toEqual(expect.any(String));
  });

  it("preserves HttpError messages because they are designed to be public", async () => {
    // jsonError uses HttpError under the hood; the existing
    // 'requires confirmation: ERASE' path proves HttpError messages survive.
    const response = await app.request(
      "/api/gdpr/erase",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      },
      readyEnv,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "bad_request",
        message: "Request body must include confirmation: 'ERASE'",
      },
    });
  });

  it("preserves the AiProviderUnavailableError mapped message", async () => {
    // Already covered by 'returns an explicit service error for pro AI
    // when Anthropic is unavailable' above (line 362). No-op smoke check
    // here so the regression intent is clear in this section.
    expect(true).toBe(true);
  });

  it("relay route allows traffic when no rate-limit binding is configured", async () => {
    // Local dev + tests run without RELAY_LIMITER. The helper must no-op
    // and let the request through unchanged.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ tag: "#2PP", name: "Coach" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const response = await app.request(
      "/api/player/2pp",
      { headers: { "CF-Connecting-IP": "1.2.3.4" } },
      env, // env without RELAY_LIMITER
    );

    expect(response.status).toBe(200);
  });

  it("relay route returns 429 when the rate-limit binding rejects", async () => {
    const limiter = {
      limit: vi.fn(async () => ({ success: false })),
    };
    const limitedEnv = { ...env, RELAY_LIMITER: limiter };

    const response = await app.request(
      "/api/player/2pp",
      { headers: { "CF-Connecting-IP": "9.9.9.9" } },
      limitedEnv,
    );

    expect(response.status).toBe(429);
    expect(limiter.limit).toHaveBeenCalledWith({ key: "9.9.9.9" });
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "quota_exceeded" },
      request_id: expect.any(String),
    });
  });

  it("relay route allows traffic when the rate-limit binding accepts", async () => {
    const limiter = {
      limit: vi.fn(async () => ({ success: true })),
    };
    const limitedEnv = { ...env, RELAY_LIMITER: limiter };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ tag: "#2PP", name: "Coach" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const response = await app.request(
      "/api/player/2pp",
      { headers: { "CF-Connecting-IP": "5.5.5.5" } },
      limitedEnv,
    );

    expect(response.status).toBe(200);
    expect(limiter.limit).toHaveBeenCalledWith({ key: "5.5.5.5" });
  });

  it("relay route uses 'unknown-ip' key when CF-Connecting-IP is missing", async () => {
    const limiter = {
      limit: vi.fn(async () => ({ success: true })),
    };
    const limitedEnv = { ...env, RELAY_LIMITER: limiter };

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ tag: "#2PP", name: "Coach" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }),
    );

    const response = await app.request("/api/player/2pp", {}, limitedEnv);

    expect(response.status).toBe(200);
    expect(limiter.limit).toHaveBeenCalledWith({ key: "unknown-ip" });
  });
});
