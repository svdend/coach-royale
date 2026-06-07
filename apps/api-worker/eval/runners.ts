/**
 * @fileoverview Backend runners for the agent eval harness (AG6, cr-c0y).
 *
 * Each runner takes a fixture and a question, returns a uniform
 * RunResult so the judge can compare them apples-to-apples. No
 * runner hits real Supercell; the fixture JSON carries its own
 * player/battles/clan data, and we install a process-global fetch
 * mock for the duration of the call.
 *
 * The Anthropic runners DO hit the real Anthropic API when a key is
 * configured — that's intentional. The goal of the eval is to
 * measure actual model quality. If the key isn't set, the runner
 * skips (not errors) so CI can run the harness to verify it's wired
 * correctly without burning real tokens.
 */

import {
  runAgentTurn,
  type AgentEvent,
  type AgentTelemetryEvent,
} from "../src/lib/agent";
import { answerCoachQuestion, generateAnalysisText } from "../src/lib/ai";
import { buildPlayerState } from "../src/lib/analytics";
import { normalizeBattle } from "../src/lib/battles";
import type { Env, NormalizedBattle, RawBattle } from "../src/types";

export interface EvalFixture {
  player: Record<string, unknown>;
  battles?: RawBattle[];
  clan?: Record<string, unknown>;
}

export interface EvalQuestion {
  id: string;
  playerTag: string;
  question: string;
  fixture: EvalFixture;
  expectations?: {
    mustMentionTools?: string[];
    mustContainSubstrings?: string[];
    mustNotHallucinateTokens?: string[];
  };
}

export type RunnerId =
  | "agent-anthropic"
  | "single-shot-anthropic"
  | "deterministic";

export interface RunResult {
  runner: RunnerId;
  questionId: string;
  text: string;
  latencyMs: number;
  toolCalls: { name: string; latencyMs: number; isError: boolean }[];
  tokens?: {
    input: number;
    output: number;
  };
  turns?: number;
  errored: boolean;
  errorReason?: string;
}

interface FetchMockOptions {
  fixture: EvalFixture;
}

/**
 * Installs a process-wide fetch mock that routes relay URLs to the
 * fixture data and passes Anthropic URLs through to the real network.
 * Returns a restore function that must be called after the runner
 * completes so the next runner sees a clean globalThis.
 */
function installFixtureFetch(options: FetchMockOptions): () => void {
  const { fixture } = options;
  const realFetch = globalThis.fetch;
  const mockedFetch: typeof fetch = async (input, init) => {
    const href =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : (input as Request).url;
    if (href.includes("/relay/player/") && href.includes("/battles")) {
      return new Response(JSON.stringify(fixture.battles ?? []), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (href.includes("/relay/clan/")) {
      return new Response(JSON.stringify(fixture.clan ?? {}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (href.includes("/relay/player/")) {
      return new Response(JSON.stringify(fixture.player), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    // Pass Anthropic (and anything else) through to the real fetch.
    return realFetch(input, init);
  };
  globalThis.fetch = mockedFetch;
  return () => {
    globalThis.fetch = realFetch;
  };
}

function relayCapableEnv(env: Env): Env {
  // The eval mocks fetch rather than standing up the relay, but relay.ts
  // requires base-url + shared-secret to be set even so. These are
  // never sent over the wire — they just have to exist.
  return {
    ...env,
    RELAY_BASE_URL: env.RELAY_BASE_URL ?? "https://eval-relay.invalid",
    RELAY_SHARED_SECRET: env.RELAY_SHARED_SECRET ?? "eval-stub",
  };
}

function normalizedBattlesFor(question: EvalQuestion): NormalizedBattle[] {
  return (question.fixture.battles ?? [])
    .map((battle) => normalizeBattle(battle, question.playerTag))
    .filter((battle): battle is NormalizedBattle => battle !== null);
}

/**
 * Runs the agentic path via runAgentTurn. Requires ANTHROPIC_API_KEY.
 * Returns a skipped RunResult (errored=true, errorReason="no_key") when
 * the key is absent so the harness can still produce a comparison
 * report for the other backends.
 */
export async function runAgentAnthropic(
  question: EvalQuestion,
  env: Env,
): Promise<RunResult> {
  if (!env.ANTHROPIC_API_KEY) {
    return {
      runner: "agent-anthropic",
      questionId: question.id,
      text: "",
      latencyMs: 0,
      toolCalls: [],
      errored: true,
      errorReason: "no_anthropic_key",
    };
  }

  const restore = installFixtureFetch({ fixture: question.fixture });
  const started = Date.now();
  const toolCalls: { name: string; latencyMs: number; isError: boolean }[] = [];
  let finalText = "";
  let errored = false;
  let errorReason: string | undefined;
  let tokens: RunResult["tokens"];
  let turns = 0;

  try {
    const onTelemetry = (event: AgentTelemetryEvent) => {
      toolCalls.push({
        name: event.toolName,
        latencyMs: event.latencyMs,
        isError: event.isError,
      });
    };
    for await (const event of runAgentTurn({
      env: relayCapableEnv(env),
      playerTag: question.playerTag,
      requestId: `eval-${question.id}`,
      userMessage: question.question,
      onTelemetry,
    }) as AsyncGenerator<AgentEvent, void, void>) {
      if (event.type === "final") {
        finalText = event.text;
        turns = event.turns;
        tokens = {
          input: event.usage.input_tokens,
          output: event.usage.output_tokens,
        };
      } else if (event.type === "error") {
        errored = true;
        errorReason = event.reason;
      }
    }
  } catch (error) {
    errored = true;
    errorReason = error instanceof Error ? error.message : "unknown";
  } finally {
    restore();
  }

  return {
    runner: "agent-anthropic",
    questionId: question.id,
    text: finalText,
    latencyMs: Date.now() - started,
    toolCalls,
    tokens,
    turns,
    errored,
    errorReason,
  };
}

/**
 * Runs the legacy single-shot answerCoachQuestion path. This is the
 * baseline we're comparing the agent against.
 */
export async function runSingleShotAnthropic(
  question: EvalQuestion,
  env: Env,
): Promise<RunResult> {
  if (!env.ANTHROPIC_API_KEY) {
    return {
      runner: "single-shot-anthropic",
      questionId: question.id,
      text: "",
      latencyMs: 0,
      toolCalls: [],
      errored: true,
      errorReason: "no_anthropic_key",
    };
  }

  const restore = installFixtureFetch({ fixture: question.fixture });
  const started = Date.now();
  let text = "";
  let errored = false;
  let errorReason: string | undefined;

  try {
    const battles = normalizedBattlesFor(question);
    const playerState = buildPlayerState(
      question.fixture.player as { tag?: string; trophies?: number },
      battles,
    );
    text = await answerCoachQuestion(
      relayCapableEnv(env),
      question.question,
      playerState,
      { allowLiveModel: true },
    );
  } catch (error) {
    errored = true;
    errorReason = error instanceof Error ? error.message : "unknown";
  } finally {
    restore();
  }

  return {
    runner: "single-shot-anthropic",
    questionId: question.id,
    text,
    latencyMs: Date.now() - started,
    toolCalls: [],
    errored,
    errorReason,
  };
}

/**
 * Runs the deterministic fallback — no LLM. Gives us a floor score so
 * we can verify Anthropic outputs actually beat "stats in a template".
 * Also functions as a smoke test that the rest of the harness is
 * wired up correctly when no API key is available.
 */
export async function runDeterministic(
  question: EvalQuestion,
  env: Env,
): Promise<RunResult> {
  const restore = installFixtureFetch({ fixture: question.fixture });
  const started = Date.now();
  let text = "";
  let errored = false;
  let errorReason: string | undefined;

  try {
    const battles = normalizedBattlesFor(question);
    const playerState = buildPlayerState(
      question.fixture.player as { tag?: string; trophies?: number },
      battles,
    );
    text = await generateAnalysisText(
      relayCapableEnv(env),
      question.fixture.player,
      playerState,
      battles,
      { allowLiveModel: false },
    );
  } catch (error) {
    errored = true;
    errorReason = error instanceof Error ? error.message : "unknown";
  } finally {
    restore();
  }

  return {
    runner: "deterministic",
    questionId: question.id,
    text,
    latencyMs: Date.now() - started,
    toolCalls: [],
    errored,
    errorReason,
  };
}
