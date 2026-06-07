/**
 * Tests for the /api/coach/agent-beta GET/PUT endpoints (AG7, cr-gh7).
 *
 * These drive the opt-in toggle the web UI talks to. Supabase is stubbed
 * so there's no real DB dependency.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "../src/index";
import * as supabaseLib from "../src/lib/supabase";
import type { Env } from "../src/types";

const TEST_USER_ID = "22222222-2222-2222-2222-222222222222";

const baseEnv: Env = {
  ALLOWED_ORIGINS: "http://localhost:5173",
  RELAY_BASE_URL: "https://relay.example.com",
  RELAY_SHARED_SECRET: "relay-secret",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "role-key",
};

function proAccess() {
  return {
    user: { id: TEST_USER_ID, email: "op@example.com" },
    tier: "pro" as const,
    limits: { quick_analysis: 999, deep_analysis: 999 },
    usage: { quick_analysis: 0, deep_analysis: 0 },
    free_ai: { daily_limit: 30, used_today: 0 },
  };
}

function freeAccess() {
  return { ...proAccess(), tier: "free" as const };
}

function anonAccess() {
  return {
    user: null as null,
    tier: "free" as const,
    limits: { quick_analysis: 5, deep_analysis: 1 },
    usage: { quick_analysis: 0, deep_analysis: 0 },
    free_ai: { daily_limit: 30, used_today: 0 },
  };
}

describe("GET /api/coach/agent-beta", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 401 for anonymous users", async () => {
    vi.spyOn(supabaseLib, "getManagedAiAccess").mockResolvedValue(anonAccess());
    const response = await app.request(
      "/api/coach/agent-beta",
      { method: "GET", headers: { authorization: "" } },
      baseEnv,
    );
    expect(response.status).toBe(401);
  });

  it("returns opted_in=false and eligible=false for a free user", async () => {
    vi.spyOn(supabaseLib, "getManagedAiAccess").mockResolvedValue(freeAccess());
    vi.spyOn(supabaseLib, "readCoachAgentBetaOptIn").mockResolvedValue(false);
    const response = await app.request(
      "/api/coach/agent-beta",
      {
        method: "GET",
        headers: { authorization: "Bearer stub" },
      },
      baseEnv,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      opted_in: boolean;
      eligible: boolean;
    };
    expect(body.opted_in).toBe(false);
    expect(body.eligible).toBe(false);
  });

  it("returns opted_in and eligible=true for a Pro user", async () => {
    vi.spyOn(supabaseLib, "getManagedAiAccess").mockResolvedValue(proAccess());
    vi.spyOn(supabaseLib, "readCoachAgentBetaOptIn").mockResolvedValue(true);
    const response = await app.request(
      "/api/coach/agent-beta",
      {
        method: "GET",
        headers: { authorization: "Bearer stub" },
      },
      baseEnv,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      opted_in: boolean;
      eligible: boolean;
    };
    expect(body.opted_in).toBe(true);
    expect(body.eligible).toBe(true);
  });
});

describe("PUT /api/coach/agent-beta", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects missing opted_in with 400", async () => {
    vi.spyOn(supabaseLib, "getManagedAiAccess").mockResolvedValue(proAccess());
    const response = await app.request(
      "/api/coach/agent-beta",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer stub",
        },
        body: JSON.stringify({}),
      },
      baseEnv,
    );
    expect(response.status).toBe(400);
  });

  it("returns 403 for free-tier users", async () => {
    vi.spyOn(supabaseLib, "getManagedAiAccess").mockResolvedValue(freeAccess());
    const response = await app.request(
      "/api/coach/agent-beta",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer stub",
        },
        body: JSON.stringify({ opted_in: true }),
      },
      baseEnv,
    );
    expect(response.status).toBe(403);
  });

  it("writes the flag for a Pro user and echoes the new value", async () => {
    vi.spyOn(supabaseLib, "getManagedAiAccess").mockResolvedValue(proAccess());
    const setSpy = vi
      .spyOn(supabaseLib, "setCoachAgentBetaOptIn")
      .mockResolvedValue(true);

    const response = await app.request(
      "/api/coach/agent-beta",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer stub",
        },
        body: JSON.stringify({ opted_in: true }),
      },
      baseEnv,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { opted_in: boolean };
    expect(body.opted_in).toBe(true);
    expect(setSpy).toHaveBeenCalledWith(expect.anything(), "Bearer stub", true);
  });

  it("accepts opted_in=false to let a Pro user back out of the beta", async () => {
    vi.spyOn(supabaseLib, "getManagedAiAccess").mockResolvedValue(proAccess());
    const setSpy = vi
      .spyOn(supabaseLib, "setCoachAgentBetaOptIn")
      .mockResolvedValue(false);

    const response = await app.request(
      "/api/coach/agent-beta",
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer stub",
        },
        body: JSON.stringify({ opted_in: false }),
      },
      baseEnv,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { opted_in: boolean };
    expect(body.opted_in).toBe(false);
    expect(setSpy).toHaveBeenCalledWith(
      expect.anything(),
      "Bearer stub",
      false,
    );
  });
});
