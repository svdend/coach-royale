/**
 * Unit tests for the rule-based judge in the eval harness (AG6).
 */

import { describe, expect, it } from "vitest";

import { ruleBasedJudge } from "../judge";
import type { EvalQuestion, RunResult } from "../runners";

function baseQuestion(
  overrides?: Partial<EvalQuestion["expectations"]>,
): EvalQuestion {
  return {
    id: "q",
    playerTag: "#T",
    question: "hi",
    fixture: { player: { tag: "#T" } },
    expectations: overrides,
  };
}

function baseResult(overrides: Partial<RunResult>): RunResult {
  return {
    runner: "agent-anthropic",
    questionId: "q",
    text: "",
    latencyMs: 0,
    toolCalls: [],
    errored: false,
    ...overrides,
  };
}

describe("ruleBasedJudge", () => {
  it("scores 1.0 on all dimensions when there are no expectations and text is present", () => {
    const score = ruleBasedJudge(
      baseQuestion(),
      baseResult({ text: "Any response." }),
    );
    expect(score.rubric.produced_output).toBe(1);
    expect(score.rubric.substring_coverage).toBe(1);
    expect(score.rubric.no_hallucination).toBe(1);
    expect(score.rubric.tool_coverage).toBe(1);
    expect(score.rubric.aggregate_rules).toBe(1);
    expect(score.notes).toEqual([]);
  });

  it("penalizes missing expected substrings proportionally", () => {
    const score = ruleBasedJudge(
      baseQuestion({ mustContainSubstrings: ["6280", "Legendary"] }),
      baseResult({ text: "You're at 6280 trophies." }),
    );
    expect(score.rubric.substring_coverage).toBe(0.5);
    expect(score.notes.some((n) => n.includes("Legendary"))).toBe(true);
  });

  it("does a case-insensitive substring check", () => {
    const score = ruleBasedJudge(
      baseQuestion({ mustContainSubstrings: ["X-BOW"] }),
      baseResult({ text: "You lost to an x-bow deck." }),
    );
    expect(score.rubric.substring_coverage).toBe(1);
  });

  it("flags hallucinated tokens when present", () => {
    const score = ruleBasedJudge(
      baseQuestion({ mustNotHallucinateTokens: ["GoldenRetrieverCard"] }),
      baseResult({
        text: "You played GoldenRetrieverCard in the last game.",
      }),
    );
    expect(score.rubric.no_hallucination).toBe(0);
    expect(score.notes.some((n) => n.includes("GoldenRetriever"))).toBe(true);
  });

  it("scores tool_coverage=1 for the agent when all expected tools were called", () => {
    const score = ruleBasedJudge(
      baseQuestion({
        mustMentionTools: ["get_player_profile", "get_recent_battles"],
      }),
      baseResult({
        text: "ok",
        toolCalls: [
          { name: "get_player_profile", latencyMs: 30, isError: false },
          { name: "get_recent_battles", latencyMs: 50, isError: false },
        ],
      }),
    );
    expect(score.rubric.tool_coverage).toBe(1);
  });

  it("penalizes the agent for missing expected tool calls", () => {
    const score = ruleBasedJudge(
      baseQuestion({
        mustMentionTools: ["get_player_profile", "get_recent_battles"],
      }),
      baseResult({
        text: "ok",
        toolCalls: [
          { name: "get_player_profile", latencyMs: 30, isError: false },
        ],
      }),
    );
    expect(score.rubric.tool_coverage).toBe(0.5);
  });

  it("does not penalize non-agent runners for missing tools", () => {
    const score = ruleBasedJudge(
      baseQuestion({
        mustMentionTools: ["get_player_profile"],
      }),
      baseResult({
        runner: "single-shot-anthropic",
        text: "ok",
        toolCalls: [],
      }),
    );
    expect(score.rubric.tool_coverage).toBe(1);
  });

  it("scores produced_output=0 when the run errored", () => {
    const score = ruleBasedJudge(
      baseQuestion(),
      baseResult({
        text: "",
        errored: true,
        errorReason: "anthropic_error",
      }),
    );
    expect(score.rubric.produced_output).toBe(0);
    expect(score.notes.some((n) => n.includes("anthropic_error"))).toBe(true);
  });

  it("scores produced_output=0 when the text is whitespace-only", () => {
    const score = ruleBasedJudge(
      baseQuestion(),
      baseResult({ text: "   \n\t  " }),
    );
    expect(score.rubric.produced_output).toBe(0);
  });
});
