/**
 * Tests for the agent loop orchestrator (AG3, cr-0fs).
 *
 * The orchestrator is tested by injecting a stub `anthropicCall` and
 * mocking `fetch` for tool dispatches. Tests collect events from the
 * async generator and assert against the ordered stream.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  runAgentTurn,
  type AgentEvent,
  type AnthropicCreateBody,
  type AnthropicCreateResponse,
  type AgentTelemetryEvent,
} from "../src/lib/agent";
import type { Env, RawBattle } from "../src/types";

const BASE_ENV: Env = {
  ANTHROPIC_API_KEY: "sk-ant-stub",
  ANTHROPIC_MODEL: "claude-test",
  RELAY_BASE_URL: "https://relay.example.com",
  RELAY_SHARED_SECRET: "relay-secret",
};

/**
 * Relay fetch mock, copied-down from tests/tools.test.ts. Keeps the two
 * test files independent so a future refactor of one doesn't silently
 * break the other.
 */
function installRelayFetch(behavior: {
  player?: Record<string, unknown>;
  battles?: RawBattle[];
  clan?: Record<string, unknown>;
}) {
  const fetchMock = vi.fn<(url: string | URL | Request) => Promise<Response>>(
    async (url) => {
      const href =
        typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
      if (href.includes("/relay/player/") && href.includes("/battles")) {
        return new Response(JSON.stringify(behavior.battles ?? []), {
          status: 200,
        });
      }
      if (href.includes("/relay/clan/")) {
        return new Response(JSON.stringify(behavior.clan ?? {}), {
          status: 200,
        });
      }
      if (href.includes("/relay/player/")) {
        return new Response(JSON.stringify(behavior.player ?? {}), {
          status: 200,
        });
      }
      throw new Error(`unexpected fetch: ${href}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function fakeCards() {
  return [
    { name: "Hog Rider" },
    { name: "Musketeer" },
    { name: "Ice Spirit" },
    { name: "Cannon" },
    { name: "Log" },
    { name: "Skeletons" },
    { name: "Fireball" },
    { name: "Ice Golem" },
  ];
}

function fakeBattle(): RawBattle {
  return {
    type: "PvP",
    battleTime: "20260101T120000.000Z",
    gameMode: { id: 1, name: "Ladder" },
    team: [
      {
        tag: "#OP",
        name: "Op",
        crowns: 1,
        trophyChange: 30,
        cards: fakeCards(),
      },
    ],
    opponent: [
      {
        tag: "#OPP",
        name: "Enemy",
        crowns: 0,
        trophyChange: -30,
        cards: fakeCards(),
      },
    ],
  };
}

/**
 * Build a minimal AnthropicCreateResponse. Convenience over correctness;
 * tests construct exactly the shape they want.
 */
function response(
  content: AnthropicCreateResponse["content"],
  stop: AnthropicCreateResponse["stop_reason"],
  usage: { input_tokens: number; output_tokens: number } = {
    input_tokens: 10,
    output_tokens: 5,
  },
): AnthropicCreateResponse {
  return {
    id: "msg_test",
    role: "assistant",
    content,
    stop_reason: stop,
    usage,
  };
}

/**
 * Scripted anthropic stub: returns the i-th response in the provided
 * array per call. Throws if Claude is called more times than scripted.
 */
function scriptedAnthropic(responses: AnthropicCreateResponse[]) {
  let i = 0;
  const calls: AnthropicCreateBody[] = [];
  const call = vi.fn(async (_env: Env, body: AnthropicCreateBody) => {
    calls.push(body);
    if (i >= responses.length) {
      throw new Error(
        `anthropic called ${i + 1} times, only ${responses.length} scripted`,
      );
    }
    const next = responses[i];
    i += 1;
    return next;
  });
  return { call, calls };
}

async function collect(
  gen: AsyncGenerator<AgentEvent, void, void>,
): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const event of gen) out.push(event);
  return out;
}

describe("runAgentTurn", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("yields final immediately when Claude returns end_turn with no tool_use", async () => {
    const { call } = scriptedAnthropic([
      response(
        [{ type: "text", text: "You're trending up. Keep queueing." }],
        "end_turn",
      ),
    ]);

    const events = await collect(
      runAgentTurn({
        env: BASE_ENV,
        playerTag: "#OP",
        requestId: "r1",
        userMessage: "How am I doing?",
        anthropicCall: call,
      }),
    );

    const types = events.map((e) => e.type);
    expect(types).toEqual(["assistant_text", "final"]);
    const finalEvent = events[events.length - 1];
    expect(finalEvent.type).toBe("final");
    if (finalEvent.type === "final") {
      expect(finalEvent.text).toMatch(/trending up/);
      expect(finalEvent.turns).toBe(0);
      expect(finalEvent.usage.input_tokens).toBe(10);
    }
  });

  it("dispatches a single tool_use and loops once before finalizing", async () => {
    installRelayFetch({
      player: { tag: "#OP", name: "Op", trophies: 6000 },
    });

    const { call, calls } = scriptedAnthropic([
      response(
        [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "get_player_profile",
            input: {},
          },
        ],
        "tool_use",
      ),
      response(
        [{ type: "text", text: "You're at 6000 trophies." }],
        "end_turn",
      ),
    ]);

    const events = await collect(
      runAgentTurn({
        env: BASE_ENV,
        playerTag: "#OP",
        requestId: "r1",
        userMessage: "What's my trophy count?",
        anthropicCall: call,
      }),
    );

    const types = events.map((e) => e.type);
    expect(types).toEqual([
      "tool_call",
      "tool_result",
      "assistant_text",
      "final",
    ]);

    const toolCall = events[0];
    expect(toolCall.type === "tool_call" && toolCall.name).toBe(
      "get_player_profile",
    );

    const toolResult = events[1];
    expect(toolResult.type === "tool_result" && toolResult.isError).toBe(false);

    // Second Claude call should carry the tool_result back in messages.
    expect(calls).toHaveLength(2);
    const secondCallMessages = calls[1].messages;
    const lastMessage = secondCallMessages[secondCallMessages.length - 1];
    expect(lastMessage.role).toBe("user");
    expect(Array.isArray(lastMessage.content)).toBe(true);
    if (Array.isArray(lastMessage.content)) {
      expect(lastMessage.content[0].type).toBe("tool_result");
    }
  });

  it("dispatches two parallel tool_use blocks in one response", async () => {
    installRelayFetch({
      player: { tag: "#OP", name: "Op", trophies: 6000 },
      battles: [fakeBattle()],
    });

    const { call } = scriptedAnthropic([
      response(
        [
          {
            type: "tool_use",
            id: "toolu_a",
            name: "get_player_profile",
            input: {},
          },
          {
            type: "tool_use",
            id: "toolu_b",
            name: "get_recent_battles",
            input: {},
          },
        ],
        "tool_use",
      ),
      response([{ type: "text", text: "Combined analysis" }], "end_turn"),
    ]);

    const events = await collect(
      runAgentTurn({
        env: BASE_ENV,
        playerTag: "#OP",
        requestId: "r1",
        userMessage: "Give me the full picture.",
        anthropicCall: call,
      }),
    );

    const toolCalls = events.filter((e) => e.type === "tool_call");
    const toolResults = events.filter((e) => e.type === "tool_result");
    expect(toolCalls).toHaveLength(2);
    expect(toolResults).toHaveLength(2);
  });

  it("reports tool runtime errors as is_error tool_results and keeps looping", async () => {
    // Make fetch throw for the relay call so dispatchTool raises
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("upstream relay down");
      }),
    );

    const { call } = scriptedAnthropic([
      response(
        [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "get_player_profile",
            input: {},
          },
        ],
        "tool_use",
      ),
      response(
        [{ type: "text", text: "Sorry, I couldn't fetch your profile." }],
        "end_turn",
      ),
    ]);

    const events = await collect(
      runAgentTurn({
        env: BASE_ENV,
        playerTag: "#OP",
        requestId: "r1",
        userMessage: "Who am I?",
        anthropicCall: call,
      }),
    );

    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult?.type === "tool_result" && toolResult.isError).toBe(true);
    // Orchestrator did NOT bail — still reached final.
    const final = events.find((e) => e.type === "final");
    expect(final).toBeDefined();
  });

  it("handles unknown tool names (hallucinated by Claude) gracefully", async () => {
    const { call } = scriptedAnthropic([
      response(
        [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "drop_table_users",
            input: {},
          },
        ],
        "tool_use",
      ),
      response([{ type: "text", text: "Never mind." }], "end_turn"),
    ]);

    const events = await collect(
      runAgentTurn({
        env: BASE_ENV,
        playerTag: "#OP",
        requestId: "r1",
        userMessage: "What's up?",
        anthropicCall: call,
      }),
    );

    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult?.type === "tool_result" && toolResult.isError).toBe(true);
    expect(toolResult?.type === "tool_result" && toolResult.content).toMatch(
      /Unknown tool/,
    );
  });

  it("rejects invalid Zod input (malformed tool args) as tool error", async () => {
    const { call } = scriptedAnthropic([
      response(
        [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "get_recent_battles",
            input: { limit: 9999 }, // out of range per Zod
          },
        ],
        "tool_use",
      ),
      response([{ type: "text", text: "Retrying." }], "end_turn"),
    ]);

    const events = await collect(
      runAgentTurn({
        env: BASE_ENV,
        playerTag: "#OP",
        requestId: "r1",
        userMessage: "Show battles",
        anthropicCall: call,
      }),
    );

    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult?.type === "tool_result" && toolResult.isError).toBe(true);
    expect(toolResult?.type === "tool_result" && toolResult.content).toMatch(
      /Invalid input/,
    );
  });

  it("emits max_turns_exceeded error when Claude never stops calling tools", async () => {
    installRelayFetch({ player: { tag: "#OP", trophies: 6000 } });

    // Script 3 turns of tool_use in a row.
    const { call } = scriptedAnthropic([
      response(
        [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "get_player_profile",
            input: {},
          },
        ],
        "tool_use",
      ),
      response(
        [
          {
            type: "tool_use",
            id: "toolu_2",
            name: "get_player_profile",
            input: {},
          },
        ],
        "tool_use",
      ),
      response(
        [
          {
            type: "tool_use",
            id: "toolu_3",
            name: "get_player_profile",
            input: {},
          },
        ],
        "tool_use",
      ),
    ]);

    const events = await collect(
      runAgentTurn({
        env: BASE_ENV,
        playerTag: "#OP",
        requestId: "r1",
        userMessage: "Loop forever please",
        maxTurns: 3,
        anthropicCall: call,
      }),
    );

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent?.type === "error" && errorEvent.reason).toBe(
      "max_turns_exceeded",
    );
    // There should be no `final` event when we exhaust turns.
    expect(events.some((e) => e.type === "final")).toBe(false);
  });

  it("surfaces anthropic_error when the Claude call fails", async () => {
    const call = vi.fn(async () => {
      throw new Error("503 backend overloaded");
    });

    const events = await collect(
      runAgentTurn({
        env: BASE_ENV,
        playerTag: "#OP",
        requestId: "r1",
        userMessage: "Hello",
        anthropicCall: call,
      }),
    );

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent?.type === "error" && errorEvent.reason).toBe(
      "anthropic_error",
    );
  });

  it("surfaces aborted when the caller's signal fires mid-loop", async () => {
    installRelayFetch({ player: { tag: "#OP", trophies: 6000 } });

    const controller = new AbortController();
    let callCount = 0;
    const call = vi.fn(async (): Promise<AnthropicCreateResponse> => {
      callCount += 1;
      if (callCount === 1) {
        return response(
          [
            {
              type: "tool_use",
              id: "toolu_1",
              name: "get_player_profile",
              input: {},
            },
          ],
          "tool_use",
        );
      }
      // By the time Claude would be called the second time, abort.
      // We abort here to simulate client cancel mid-loop.
      controller.abort();
      throw new DOMException("aborted", "AbortError");
    });

    const events = await collect(
      runAgentTurn({
        env: BASE_ENV,
        playerTag: "#OP",
        requestId: "r1",
        userMessage: "anything",
        signal: controller.signal,
        anthropicCall: call,
      }),
    );

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent?.type === "error" && errorEvent.reason).toBe("aborted");
  });

  it("invokes onTelemetry once per tool call with latency and error flag", async () => {
    installRelayFetch({ player: { tag: "#OP", trophies: 6000 } });

    const { call } = scriptedAnthropic([
      response(
        [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "get_player_profile",
            input: {},
          },
        ],
        "tool_use",
      ),
      response([{ type: "text", text: "ok" }], "end_turn"),
    ]);

    const telemetry: AgentTelemetryEvent[] = [];
    await collect(
      runAgentTurn({
        env: BASE_ENV,
        playerTag: "#OP",
        requestId: "r1",
        userMessage: "hi",
        anthropicCall: call,
        onTelemetry: (e) => telemetry.push(e),
      }),
    );

    expect(telemetry).toHaveLength(1);
    expect(telemetry[0].toolName).toBe("get_player_profile");
    expect(telemetry[0].isError).toBe(false);
    expect(telemetry[0].turn).toBe(0);
    expect(typeof telemetry[0].latencyMs).toBe("number");
    expect(telemetry[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("preserves history and appends the user message + assistant/tool turns", async () => {
    const { call, calls } = scriptedAnthropic([
      response([{ type: "text", text: "hi back" }], "end_turn"),
    ]);

    const prior = [
      { role: "user" as const, content: "first message" },
      { role: "assistant" as const, content: "first reply" },
    ];

    const events = await collect(
      runAgentTurn({
        env: BASE_ENV,
        playerTag: "#OP",
        requestId: "r1",
        userMessage: "second message",
        history: prior,
        anthropicCall: call,
      }),
    );

    // The first Claude call should receive history + new user message.
    expect(calls[0].messages).toHaveLength(3);
    expect(calls[0].messages[0].content).toBe("first message");
    expect(calls[0].messages[2].content).toBe("second message");

    // The final event's messages should include every message.
    const final = events.find((e) => e.type === "final");
    expect(
      final?.type === "final" && final.messages.length,
    ).toBeGreaterThanOrEqual(4);
  });

  it("yields anthropic_unavailable when ANTHROPIC_API_KEY is missing (default call path)", async () => {
    const envWithoutKey: Env = { ...BASE_ENV, ANTHROPIC_API_KEY: undefined };

    const events = await collect(
      runAgentTurn({
        env: envWithoutKey,
        playerTag: "#OP",
        requestId: "r1",
        userMessage: "hi",
        // No injected anthropicCall — uses the default which checks the key.
      }),
    );

    const errorEvent = events.find((e) => e.type === "error");
    expect(errorEvent?.type === "error" && errorEvent.reason).toBe(
      "anthropic_unavailable",
    );
  });

  it("tool_call events see the playerTag from context, not one the model may invent", async () => {
    const fetchMock = installRelayFetch({
      player: { tag: "#OP", trophies: 6000 },
    });

    const { call } = scriptedAnthropic([
      response(
        [
          {
            type: "tool_use",
            id: "toolu_1",
            name: "get_player_profile",
            input: { player_tag: "#HACKER" }, // model-supplied, must be ignored
          },
        ],
        "tool_use",
      ),
      response([{ type: "text", text: "done" }], "end_turn"),
    ]);

    const events = await collect(
      runAgentTurn({
        env: BASE_ENV,
        playerTag: "#OP",
        requestId: "r1",
        userMessage: "look me up",
        anthropicCall: call,
      }),
    );

    // Zod rejects the unknown player_tag field → tool_result with is_error.
    const toolResult = events.find((e) => e.type === "tool_result");
    expect(toolResult?.type === "tool_result" && toolResult.isError).toBe(true);

    // And fetch was never called with #HACKER — the dispatcher rejected
    // the input before the tool ran.
    const fetchedUrls = fetchMock.mock.calls.map((c) => {
      const arg = c[0];
      return typeof arg === "string"
        ? arg
        : arg instanceof URL
          ? arg.href
          : arg.url;
    });
    for (const href of fetchedUrls) {
      expect(href).not.toMatch(/HACKER/);
    }
  });
});
