/**
 * @fileoverview Agent loop orchestrator for Pro coaching chat (AG3, cr-0fs).
 *
 * Runs an Anthropic messages.create loop with the tool registry from
 * ./tools.ts, dispatching tool_use blocks against the worker's data
 * functions and feeding results back until Claude emits end_turn or
 * the orchestrator's budget is exhausted.
 *
 * Design notes (see feat/ag3 commit message for full rationale):
 *
 *   - Non-streaming in this revision. Claude supports streaming tool_use
 *     via SSE but the delta-assembly for JSON tool inputs is non-trivial;
 *     we ship the robust non-streaming flow first and yield progress
 *     events through the AsyncGenerator so AG4 can still surface
 *     tool-call hints to the UI in near-real-time between turns.
 *
 *   - Tool runtime errors are reported to Claude as tool_result blocks
 *     with is_error: true, never bubbled. Claude handles this robustly
 *     and often recovers by trying a different tool or concluding
 *     gracefully. We only fail hard on: Claude itself erroring, the
 *     AbortSignal firing, or the max-turn budget being exhausted.
 *
 *   - Hard caps live here, not in the tool registry. MAX_TURNS
 *     (tool-call rounds) and an overall AbortSignal prevent runaway
 *     loops and unbounded latency regardless of model behavior.
 *
 *   - Telemetry is exposed as an optional onTelemetry callback so the
 *     route handler can write Analytics Engine events without the
 *     orchestrator knowing about AE bindings. Keeps this module
 *     pure-ish and trivially testable.
 */

import {
  UnknownToolError,
  ToolInputError,
  dispatchTool,
  toolSchemas,
  type ToolContext,
} from "./tools";
import type { Env } from "../types";

// ---------------------------------------------------------------------------
// Wire types — hand-rolled so we don't take a dependency on @anthropic-ai/sdk.
// ---------------------------------------------------------------------------

/** Block types in Anthropic's content array. Non-exhaustive — we only
 * consume text and tool_use, and only emit text, tool_use, tool_result. */
export type AnthropicContentBlock =
  | { type: "text"; text: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | {
      type: "tool_result";
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    };

export interface AnthropicMessage {
  role: "user" | "assistant";
  content: string | AnthropicContentBlock[];
}

export interface AnthropicResponseUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface AnthropicCreateResponse {
  id: string;
  role: "assistant";
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | null;
  content: AnthropicContentBlock[];
  usage?: AnthropicResponseUsage;
}

// ---------------------------------------------------------------------------
// Agent event stream — yielded by runAgentTurn.
// ---------------------------------------------------------------------------

export type AgentEvent =
  | {
      type: "assistant_text";
      /** Partial or full assistant text from the current turn. */
      text: string;
    }
  | {
      type: "tool_call";
      toolUseId: string;
      name: string;
      input: unknown;
    }
  | {
      type: "tool_result";
      toolUseId: string;
      name: string;
      isError: boolean;
      /** Stringified tool output or error message; what we sent to Claude. */
      content: string;
      /** Wall-clock ms spent dispatching the tool. */
      latencyMs: number;
    }
  | {
      type: "final";
      /** Concatenated text content from the last assistant message. */
      text: string;
      /** Full message history (initial input + every turn) for persistence. */
      messages: AnthropicMessage[];
      /** Aggregated Anthropic usage across all turns. */
      usage: AnthropicResponseUsage;
      /** Number of completed tool-call rounds. */
      turns: number;
    }
  | {
      type: "error";
      reason:
        | "max_turns_exceeded"
        | "aborted"
        | "anthropic_unavailable"
        | "anthropic_error";
      /** Human-readable context; never expose to end users verbatim. */
      detail?: string;
    };

/** Per-tool-call telemetry hook. AG4 wires this to Analytics Engine. */
export type AgentTelemetryEvent = {
  toolName: string;
  isError: boolean;
  latencyMs: number;
  turn: number;
};

export interface RunAgentTurnOptions {
  env: Env;
  /** Authoritative player tag for tool context — the model cannot override. */
  playerTag: string;
  /** Correlates logs across tool/relay calls. */
  requestId: string;
  /** The user's latest message. */
  userMessage: string;
  /** Prior conversation turns (stored in coach_messages / coach_threads). */
  history?: AnthropicMessage[];
  /** Optional system prompt override. */
  systemPrompt?: string;
  /** Max tool-call rounds. Default 5. */
  maxTurns?: number;
  /** Overall deadline. Default 120s. */
  signal?: AbortSignal;
  /** Optional per-tool-call observer. */
  onTelemetry?: (event: AgentTelemetryEvent) => void;
  /** Injection point for tests. Defaults to the real Anthropic call. */
  anthropicCall?: (
    env: Env,
    body: AnthropicCreateBody,
    signal: AbortSignal,
  ) => Promise<AnthropicCreateResponse>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const DEFAULT_SYSTEM_PROMPT =
  "You are an elite Clash Royale coach helping a single player improve. " +
  "You have read-only tools to inspect the player's profile, recent battles, " +
  "deterministic analytics (win rates, matchups, tilt), deck stats, matchup " +
  "breakdowns, and clan context. Prefer consulting these tools over guessing. " +
  "When you have enough information, answer concisely and specifically, " +
  "grounding advice in the numbers you found. Avoid generic advice.";

const DEFAULT_MAX_TURNS = 5;
const DEFAULT_TOTAL_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_TOKENS = 1024;
const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

// ---------------------------------------------------------------------------
// Real Anthropic call (default injection point)
// ---------------------------------------------------------------------------

export interface AnthropicCreateBody {
  model: string;
  max_tokens: number;
  system?: string;
  tools?: typeof toolSchemas;
  messages: AnthropicMessage[];
}

async function defaultAnthropicCall(
  env: Env,
  body: AnthropicCreateBody,
  signal: AbortSignal,
): Promise<AnthropicCreateResponse> {
  if (!env.ANTHROPIC_API_KEY) {
    throw new AgentRunError("anthropic_unavailable", "missing API key");
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new AgentRunError(
      "anthropic_error",
      `HTTP ${response.status}: ${text.slice(0, 200)}`,
    );
  }

  return (await response.json()) as AnthropicCreateResponse;
}

/** Internal error for orchestrator control flow; surfaces as AgentEvent. */
class AgentRunError extends Error {
  constructor(
    public readonly reason: Exclude<
      Extract<AgentEvent, { type: "error" }>["reason"],
      "max_turns_exceeded" | "aborted"
    >,
    detail: string,
  ) {
    super(detail);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textFromContent(content: AnthropicContentBlock[]): string {
  return content
    .filter(
      (block): block is Extract<AnthropicContentBlock, { type: "text" }> =>
        block.type === "text",
    )
    .map((block) => block.text)
    .join("\n")
    .trim();
}

function toolUsesFromContent(
  content: AnthropicContentBlock[],
): Extract<AnthropicContentBlock, { type: "tool_use" }>[] {
  return content.filter(
    (block): block is Extract<AnthropicContentBlock, { type: "tool_use" }> =>
      block.type === "tool_use",
  );
}

function truncateForClaude(value: string, max = 8000): string {
  if (value.length <= max) return value;
  return (
    value.slice(0, max) +
    `\n…[truncated: ${value.length - max} more characters]`
  );
}

/**
 * Merges one or more abort signals into a single signal. Clean cancel
 * path when the caller supplies their own signal and we also impose
 * a total-timeout signal — whichever aborts first wins.
 */
function mergeSignals(signals: (AbortSignal | undefined)[]): AbortSignal {
  const controller = new AbortController();
  for (const signal of signals) {
    if (!signal) continue;
    if (signal.aborted) {
      controller.abort(signal.reason);
      return controller.signal;
    }
    signal.addEventListener("abort", () => controller.abort(signal.reason), {
      once: true,
    });
  }
  return controller.signal;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Runs one user-initiated agent turn. Yields AgentEvents in order:
 *
 *   - assistant_text       (zero or more; every non-final turn that also
 *                           contained narrative text)
 *   - tool_call            (zero or more per turn; emitted BEFORE dispatch)
 *   - tool_result          (one per tool_call; emitted AFTER dispatch)
 *   - final OR error       (exactly one, terminates the generator)
 *
 * Never throws. All error paths are captured as `{type: "error", reason}`.
 */
export async function* runAgentTurn(
  options: RunAgentTurnOptions,
): AsyncGenerator<AgentEvent, void, void> {
  const maxTurns = options.maxTurns ?? DEFAULT_MAX_TURNS;
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(
    () => timeoutController.abort(new Error("agent_turn_deadline")),
    DEFAULT_TOTAL_TIMEOUT_MS,
  );
  const signal = mergeSignals([options.signal, timeoutController.signal]);
  const anthropicCall = options.anthropicCall ?? defaultAnthropicCall;

  const toolContext: ToolContext = {
    env: options.env,
    playerTag: options.playerTag,
    requestId: options.requestId,
  };

  const messages: AnthropicMessage[] = [
    ...(options.history ?? []),
    { role: "user", content: options.userMessage },
  ];

  const totalUsage: AnthropicResponseUsage = {
    input_tokens: 0,
    output_tokens: 0,
  };

  const model =
    options.env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-20250514";
  const systemPrompt = options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT;

  try {
    for (let turn = 0; turn < maxTurns; turn++) {
      if (signal.aborted) {
        yield { type: "error", reason: "aborted" };
        return;
      }

      let response: AnthropicCreateResponse;
      try {
        response = await anthropicCall(
          options.env,
          {
            model,
            max_tokens: DEFAULT_MAX_TOKENS,
            system: systemPrompt,
            tools: toolSchemas,
            // Snapshot: orchestrator mutates `messages` in place between
            // turns, so we hand Claude a copy to avoid callers (including
            // tests and future telemetry consumers) observing post-call
            // mutations.
            messages: messages.slice(),
          },
          signal,
        );
      } catch (error) {
        if (error instanceof AgentRunError) {
          yield {
            type: "error",
            reason: error.reason,
            detail: error.message,
          };
          return;
        }
        if (error instanceof DOMException && error.name === "AbortError") {
          yield { type: "error", reason: "aborted" };
          return;
        }
        yield {
          type: "error",
          reason: "anthropic_error",
          detail: error instanceof Error ? error.message : String(error),
        };
        return;
      }

      if (response.usage) {
        totalUsage.input_tokens += response.usage.input_tokens;
        totalUsage.output_tokens += response.usage.output_tokens;
      }

      // Append the assistant message verbatim so tool_use blocks persist
      // in conversation history. Anthropic requires the full block list
      // to round-trip when we send tool_results.
      messages.push({ role: "assistant", content: response.content });

      const text = textFromContent(response.content);
      if (text) {
        yield { type: "assistant_text", text };
      }

      if (
        response.stop_reason === "end_turn" ||
        response.stop_reason === "stop_sequence" ||
        response.stop_reason === "max_tokens"
      ) {
        yield {
          type: "final",
          text,
          messages,
          usage: totalUsage,
          turns: turn,
        };
        return;
      }

      if (response.stop_reason !== "tool_use") {
        // Unknown stop_reason — log and bail with the accumulated text.
        yield {
          type: "final",
          text,
          messages,
          usage: totalUsage,
          turns: turn,
        };
        return;
      }

      const toolUses = toolUsesFromContent(response.content);
      if (toolUses.length === 0) {
        // Anthropic said tool_use but emitted none. Defensive: treat as
        // final so we don't loop forever on degenerate responses.
        yield {
          type: "final",
          text,
          messages,
          usage: totalUsage,
          turns: turn,
        };
        return;
      }

      // Dispatch tool calls sequentially. Anthropic supports parallel
      // tool_use blocks but serial dispatch keeps relay/DB pressure
      // predictable and makes telemetry/event ordering clear.
      const toolResults: Extract<
        AnthropicContentBlock,
        { type: "tool_result" }
      >[] = [];

      for (const toolUse of toolUses) {
        if (signal.aborted) {
          yield { type: "error", reason: "aborted" };
          return;
        }

        yield {
          type: "tool_call",
          toolUseId: toolUse.id,
          name: toolUse.name,
          input: toolUse.input,
        };

        const started = Date.now();
        let resultContent: string;
        let isError = false;
        try {
          const raw = await dispatchTool(
            toolContext,
            toolUse.name,
            toolUse.input,
          );
          resultContent = truncateForClaude(JSON.stringify(raw));
        } catch (error) {
          isError = true;
          if (
            error instanceof UnknownToolError ||
            error instanceof ToolInputError
          ) {
            resultContent = error.message;
          } else if (error instanceof Error) {
            // Keep upstream error messages terse — Claude doesn't need
            // stack traces and detailed internals can leak context.
            resultContent = `tool_runtime_error: ${error.message.slice(0, 200)}`;
          } else {
            resultContent = "tool_runtime_error: unknown";
          }
        }

        const latencyMs = Date.now() - started;

        yield {
          type: "tool_result",
          toolUseId: toolUse.id,
          name: toolUse.name,
          isError,
          content: resultContent,
          latencyMs,
        };

        if (options.onTelemetry) {
          try {
            options.onTelemetry({
              toolName: toolUse.name,
              isError,
              latencyMs,
              turn,
            });
          } catch {
            // Telemetry must never fail the agent loop.
          }
        }

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolUse.id,
          content: resultContent,
          is_error: isError,
        });
      }

      messages.push({ role: "user", content: toolResults });
    }

    yield {
      type: "error",
      reason: "max_turns_exceeded",
      detail: `exceeded ${maxTurns} tool-use rounds`,
    };
  } finally {
    clearTimeout(timeoutId);
  }
}
