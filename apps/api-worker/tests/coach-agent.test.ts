/**
 * Tests for the streaming /api/coach/agent/:tag endpoint (AG4, cr-dn6).
 *
 * These are integration-ish tests: the Hono app is exercised end-to-end
 * but the Supabase and coach-threads modules are stubbed via vi.spyOn
 * so the tests don't need a real Postgres. Anthropic is stubbed at the
 * fetch layer.
 *
 * We don't import ai.ts functions here — the orchestrator uses the real
 * Anthropic HTTP call path by default, which we hijack via a global
 * fetch mock.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { app } from "../src/index";
import * as supabaseLib from "../src/lib/supabase";
import * as coachThreadsLib from "../src/lib/coach-threads";
import type { Env } from "../src/types";

const TEST_THREAD_ID = "11111111-1111-1111-1111-111111111111";
const TEST_USER_ID = "22222222-2222-2222-2222-222222222222";
const TEST_PLAYER_TAG = "#ABC123";

const baseEnv: Env = {
  ALLOWED_ORIGINS: "http://localhost:5173",
  RELAY_BASE_URL: "https://relay.example.com",
  RELAY_SHARED_SECRET: "relay-secret",
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "role-key",
  ANTHROPIC_API_KEY: "sk-ant-test",
  ANTHROPIC_MODEL: "claude-test",
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
  return {
    ...proAccess(),
    tier: "free" as const,
  };
}

/**
 * Hijack fetch for outbound Anthropic calls only. Other fetches (if any)
 * route through and will fail the test with a clear error.
 */
function stubAnthropic(responses: object[]) {
  let i = 0;
  const calls: RequestInit[] = [];
  const fetchMock = vi.fn(
    async (url: string | URL | Request, init?: RequestInit) => {
      const href =
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      if (href.startsWith("https://api.anthropic.com")) {
        calls.push(init ?? {});
        if (i >= responses.length) {
          throw new Error(
            `anthropic called ${i + 1} times, scripted only ${responses.length}`,
          );
        }
        const next = responses[i];
        i += 1;
        return new Response(JSON.stringify(next), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${href}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

/**
 * Parse an SSE body string into a list of (event, data) pairs.
 * Handles the `event: <type>\ndata: <json>\n\n` format the endpoint emits.
 */
function parseSse(body: string): { event: string; data: unknown }[] {
  const frames: { event: string; data: unknown }[] = [];
  for (const block of body.split("\n\n")) {
    const trimmed = block.trim();
    if (!trimmed) continue;
    let event = "message";
    const dataLines: string[] = [];
    for (const line of trimmed.split("\n")) {
      if (line.startsWith("event: ")) event = line.slice(7).trim();
      else if (line.startsWith("data: ")) dataLines.push(line.slice(6));
    }
    const dataRaw = dataLines.join("\n");
    let data: unknown;
    try {
      data = JSON.parse(dataRaw);
    } catch {
      data = dataRaw;
    }
    frames.push({ event, data });
  }
  return frames;
}

describe("POST /api/coach/agent/:tag", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    // AG7 added a beta opt-in gate on this endpoint. Existing tests
    // here were written before AG7, so default the flag to true so
    // they still exercise the success/failure paths they care about.
    // The dedicated AG7 test block below flips this to false.
    vi.spyOn(supabaseLib, "readCoachAgentBetaOptIn").mockResolvedValue(true);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requires a question in the body", async () => {
    const response = await app.request(
      `/api/coach/agent/${encodeURIComponent(TEST_PLAYER_TAG)}`,
      {
        method: "POST",
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

  it("rejects free-tier users with 403", async () => {
    vi.spyOn(supabaseLib, "getManagedAiAccess").mockResolvedValue(freeAccess());

    const response = await app.request(
      `/api/coach/agent/${encodeURIComponent(TEST_PLAYER_TAG)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer stub",
        },
        body: JSON.stringify({ question: "Help" }),
      },
      baseEnv,
    );
    expect(response.status).toBe(403);
  });

  it("streams SSE frames for a zero-tool turn and persists the user + assistant messages", async () => {
    vi.spyOn(supabaseLib, "getManagedAiAccess").mockResolvedValue(proAccess());
    const createSpy = vi
      .spyOn(coachThreadsLib, "createCoachThread")
      .mockResolvedValue({
        id: TEST_THREAD_ID,
        user_id: TEST_USER_ID,
        player_tag: TEST_PLAYER_TAG,
        title: null,
        created_at: "now",
        updated_at: "now",
      });
    const appendSpy = vi
      .spyOn(coachThreadsLib, "appendCoachMessage")
      .mockImplementation(async (_env, _auth, params) => ({
        id: "msg-" + Math.random(),
        thread_id: params.thread_id,
        role: params.role,
        content: params.content,
        tool_calls: null,
        created_at: "now",
      }));

    stubAnthropic([
      {
        id: "msg_1",
        role: "assistant",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Keep queueing, you're good." }],
        usage: { input_tokens: 5, output_tokens: 5 },
      },
    ]);

    const response = await app.request(
      `/api/coach/agent/${encodeURIComponent(TEST_PLAYER_TAG)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer stub",
        },
        body: JSON.stringify({ question: "How am I doing?" }),
      },
      baseEnv,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const body = await response.text();
    const frames = parseSse(body);

    // First frame: thread metadata
    expect(frames[0].event).toBe("thread");
    expect(frames[0].data).toMatchObject({
      thread_id: TEST_THREAD_ID,
      player_tag: TEST_PLAYER_TAG,
    });

    // Last frame: final
    const finalFrame = frames[frames.length - 1];
    expect(finalFrame.event).toBe("final");

    // Thread was created because no thread_id was supplied.
    expect(createSpy).toHaveBeenCalledTimes(1);

    // At least two appendCoachMessage calls: user prompt + assistant reply.
    expect(appendSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    const roles = appendSpy.mock.calls.map((call) => call[2].role);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
  });

  it("resumes an existing thread when thread_id is provided and owned by user", async () => {
    vi.spyOn(supabaseLib, "getManagedAiAccess").mockResolvedValue(proAccess());
    const getSpy = vi
      .spyOn(coachThreadsLib, "getCoachThread")
      .mockResolvedValue({
        id: TEST_THREAD_ID,
        user_id: TEST_USER_ID,
        player_tag: TEST_PLAYER_TAG,
        title: null,
        created_at: "now",
        updated_at: "now",
      });
    const listSpy = vi
      .spyOn(coachThreadsLib, "listCoachMessages")
      .mockResolvedValue([
        {
          id: "m1",
          thread_id: TEST_THREAD_ID,
          role: "user",
          content: "earlier question",
          tool_calls: null,
          created_at: "earlier",
        },
        {
          id: "m2",
          thread_id: TEST_THREAD_ID,
          role: "assistant",
          content: "earlier answer",
          tool_calls: null,
          created_at: "earlier",
        },
      ]);
    const createSpy = vi.spyOn(coachThreadsLib, "createCoachThread");
    vi.spyOn(coachThreadsLib, "appendCoachMessage").mockImplementation(
      async (_env, _auth, params) => ({
        id: "msg-" + Math.random(),
        thread_id: params.thread_id,
        role: params.role,
        content: params.content,
        tool_calls: null,
        created_at: "now",
      }),
    );

    stubAnthropic([
      {
        id: "msg_1",
        role: "assistant",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Continuing." }],
        usage: { input_tokens: 5, output_tokens: 5 },
      },
    ]);

    const response = await app.request(
      `/api/coach/agent/${encodeURIComponent(TEST_PLAYER_TAG)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer stub",
        },
        body: JSON.stringify({
          thread_id: TEST_THREAD_ID,
          question: "Keep going",
        }),
      },
      baseEnv,
    );
    expect(response.status).toBe(200);
    await response.text();

    expect(getSpy).toHaveBeenCalledWith(
      expect.anything(),
      expect.any(String),
      TEST_THREAD_ID,
    );
    expect(listSpy).toHaveBeenCalled();
    // Existing thread owned by user → no new thread created.
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("creates a new thread when the supplied thread_id is not owned by the user", async () => {
    vi.spyOn(supabaseLib, "getManagedAiAccess").mockResolvedValue(proAccess());
    vi.spyOn(coachThreadsLib, "getCoachThread").mockResolvedValue(null);
    const createSpy = vi
      .spyOn(coachThreadsLib, "createCoachThread")
      .mockResolvedValue({
        id: TEST_THREAD_ID,
        user_id: TEST_USER_ID,
        player_tag: TEST_PLAYER_TAG,
        title: null,
        created_at: "now",
        updated_at: "now",
      });
    vi.spyOn(coachThreadsLib, "appendCoachMessage").mockImplementation(
      async (_env, _auth, params) => ({
        id: "msg-" + Math.random(),
        thread_id: params.thread_id,
        role: params.role,
        content: params.content,
        tool_calls: null,
        created_at: "now",
      }),
    );

    stubAnthropic([
      {
        id: "msg_1",
        role: "assistant",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Hi" }],
        usage: { input_tokens: 5, output_tokens: 5 },
      },
    ]);

    const response = await app.request(
      `/api/coach/agent/${encodeURIComponent(TEST_PLAYER_TAG)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer stub",
        },
        body: JSON.stringify({
          thread_id: "33333333-3333-3333-3333-333333333333",
          question: "Hi",
        }),
      },
      baseEnv,
    );
    expect(response.status).toBe(200);
    await response.text();
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it("surfaces anthropic errors as a final error SSE frame rather than HTTP 500", async () => {
    vi.spyOn(supabaseLib, "getManagedAiAccess").mockResolvedValue(proAccess());
    vi.spyOn(coachThreadsLib, "createCoachThread").mockResolvedValue({
      id: TEST_THREAD_ID,
      user_id: TEST_USER_ID,
      player_tag: TEST_PLAYER_TAG,
      title: null,
      created_at: "now",
      updated_at: "now",
    });
    vi.spyOn(coachThreadsLib, "appendCoachMessage").mockImplementation(
      async (_env, _auth, params) => ({
        id: "msg-" + Math.random(),
        thread_id: params.thread_id,
        role: params.role,
        content: params.content,
        tool_calls: null,
        created_at: "now",
      }),
    );

    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href =
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      if (href.startsWith("https://api.anthropic.com")) {
        return new Response("overloaded", { status: 503 });
      }
      throw new Error(`unexpected fetch: ${href}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const response = await app.request(
      `/api/coach/agent/${encodeURIComponent(TEST_PLAYER_TAG)}`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer stub",
        },
        body: JSON.stringify({ question: "Hi" }),
      },
      baseEnv,
    );

    // The endpoint returns 200 because the stream itself succeeded;
    // the user sees the failure as an SSE `error` frame.
    expect(response.status).toBe(200);
    const frames = parseSse(await response.text());
    const errorFrame = frames.find((f) => f.event === "error");
    expect(errorFrame).toBeDefined();
    expect((errorFrame?.data as { reason?: string })?.reason).toBe(
      "anthropic_error",
    );
  });

  // --- AG7 beta opt-in gate ---------------------------------------------

  describe("beta opt-in gate (AG7)", () => {
    it("returns 403 when the Pro user has not opted in to the beta", async () => {
      vi.spyOn(supabaseLib, "getManagedAiAccess").mockResolvedValue(
        proAccess(),
      );
      vi.spyOn(supabaseLib, "readCoachAgentBetaOptIn").mockResolvedValue(false);

      const response = await app.request(
        `/api/coach/agent/${encodeURIComponent(TEST_PLAYER_TAG)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer stub",
          },
          body: JSON.stringify({ question: "hi" }),
        },
        baseEnv,
      );
      expect(response.status).toBe(403);
      const body = (await response.json()) as {
        error?: { code?: string; message?: string };
      };
      // The route surfaces the specific code so the UI can deep-link to
      // the beta toggle rather than the generic upgrade CTA.
      expect(body.error?.code).toBe("forbidden_beta_optin_required");
    });

    it("allows a Pro user who has opted in to reach the stream", async () => {
      vi.spyOn(supabaseLib, "getManagedAiAccess").mockResolvedValue(
        proAccess(),
      );
      vi.spyOn(supabaseLib, "readCoachAgentBetaOptIn").mockResolvedValue(true);
      vi.spyOn(coachThreadsLib, "createCoachThread").mockResolvedValue({
        id: TEST_THREAD_ID,
        user_id: TEST_USER_ID,
        player_tag: TEST_PLAYER_TAG,
        title: null,
        created_at: "now",
        updated_at: "now",
      });
      vi.spyOn(coachThreadsLib, "appendCoachMessage").mockImplementation(
        async (_env, _auth, params) => ({
          id: "msg-" + Math.random(),
          thread_id: params.thread_id,
          role: params.role,
          content: params.content,
          tool_calls: null,
          created_at: "now",
        }),
      );
      stubAnthropic([
        {
          id: "msg_1",
          role: "assistant",
          stop_reason: "end_turn",
          content: [{ type: "text", text: "ok" }],
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ]);

      const response = await app.request(
        `/api/coach/agent/${encodeURIComponent(TEST_PLAYER_TAG)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: "Bearer stub",
          },
          body: JSON.stringify({ question: "hi" }),
        },
        baseEnv,
      );
      expect(response.status).toBe(200);
      await response.text();
    });
  });
});
