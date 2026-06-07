import { beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "../src/index";
import * as supabaseLib from "../src/lib/supabase";
import type { Env } from "../src/types";

const env: Env = {
  ALLOWED_ORIGINS: "http://localhost:5173",
  RELAY_BASE_URL: "https://relay.example.com",
  RELAY_SHARED_SECRET: "relay-secret",
};

describe("FS review workflow smoke (mocked)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("serves deterministic quick AI for anonymous users without Supabase", async () => {
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
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      result: { response: expect.stringContaining("quick stats") },
    });
  });

  it("deduplicates identical Lemon webhook deliveries at the handler boundary", async () => {
    const recordSpy = vi
      .spyOn(supabaseLib, "tryRecordSubscriptionWebhookEvent")
      .mockResolvedValueOnce("inserted")
      .mockResolvedValueOnce("duplicate");
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
        id: "sub_dup",
        attributes: { status: "active" },
      },
    });
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode("webhook-secret"),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = Array.from(
      new Uint8Array(
        await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
      ),
    )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    const opts = { ...env, LEMONSQUEEZY_WEBHOOK_SECRET: "webhook-secret" };
    await app.request(
      "/api/payments/webhook",
      {
        method: "POST",
        headers: { "X-Signature": sig },
        body,
      },
      opts,
    );
    await app.request(
      "/api/payments/webhook",
      {
        method: "POST",
        headers: { "X-Signature": sig },
        body,
      },
      opts,
    );

    expect(recordSpy).toHaveBeenCalledTimes(2);
    expect(updateSpy).toHaveBeenCalledTimes(1);
  });
});
