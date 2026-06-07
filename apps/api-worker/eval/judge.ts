/**
 * @fileoverview Scoring layer for the agent eval harness (AG6, cr-c0y).
 *
 * Two modes:
 *
 * 1. Rule-based judge (no API key needed). Scores on:
 *      - substring coverage (did the answer contain the expected tokens?)
 *      - hallucination guard (did the answer avoid tokens it shouldn't know?)
 *      - tool-call coverage for agent runs (did it use the expected tools?)
 *      - non-empty / non-error
 *    Produces a 0..1 score per dimension and an aggregate.
 *
 * 2. Judge-model scorer (Anthropic). Prompts Claude to return a JSON
 *    rubric score. Used when ANTHROPIC_API_KEY is set AND the caller
 *    opts in via useModelJudge=true. Never required.
 *
 * The two modes are additive: the rule-based score is always computed
 * (cheap, deterministic). The judge score is a nice-to-have added when
 * available.
 */

import type { EvalQuestion, RunResult } from "./runners";
import type { Env } from "../src/types";

export interface RubricScores {
  /** Did the output mention the substrings the fixture flagged as required? */
  substring_coverage: number;
  /** Did the output avoid introducing hallucinated tokens the fixture flagged? */
  no_hallucination: number;
  /** Did the (agent) output invoke the tools the fixture expected? */
  tool_coverage: number;
  /** Was there output at all? */
  produced_output: number;
  /** Mean of the four rule-based dimensions. */
  aggregate_rules: number;
  /** Optional: judge-model score 0..1 based on specificity + correctness. */
  judge_model_score?: number;
}

export interface ScoreResult {
  runner: RunResult["runner"];
  questionId: string;
  rubric: RubricScores;
  notes: string[];
}

/**
 * Rule-based judge. Always runs. Returns a 0..1 score per dimension
 * and a set of human-readable notes explaining deductions.
 */
export function ruleBasedJudge(
  question: EvalQuestion,
  result: RunResult,
): ScoreResult {
  const notes: string[] = [];
  const expectations = question.expectations ?? {};
  const expectedSubstrings = expectations.mustContainSubstrings ?? [];
  const forbiddenTokens = expectations.mustNotHallucinateTokens ?? [];
  const expectedTools = expectations.mustMentionTools ?? [];

  // Substring coverage: fraction of expected substrings that appear.
  let substringCoverage = 1;
  if (expectedSubstrings.length > 0) {
    const hits = expectedSubstrings.filter((s) =>
      result.text.toLowerCase().includes(s.toLowerCase()),
    );
    substringCoverage = hits.length / expectedSubstrings.length;
    if (substringCoverage < 1) {
      const missing = expectedSubstrings.filter((s) => !hits.includes(s));
      notes.push(`missing expected substrings: ${missing.join(", ")}`);
    }
  }

  // Hallucination guard: 1 if none of the forbidden tokens appear, else
  // proportional to how many slipped in.
  let noHallucination = 1;
  if (forbiddenTokens.length > 0) {
    const slipped = forbiddenTokens.filter((t) =>
      result.text.toLowerCase().includes(t.toLowerCase()),
    );
    noHallucination = 1 - slipped.length / forbiddenTokens.length;
    if (slipped.length > 0) {
      notes.push(`hallucinated forbidden tokens: ${slipped.join(", ")}`);
    }
  }

  // Tool coverage. Non-agent runners get a free pass (they have no tools
  // by design); the rubric only penalizes the agent for missing them.
  let toolCoverage = 1;
  if (expectedTools.length > 0) {
    if (result.runner === "agent-anthropic") {
      const called = new Set(result.toolCalls.map((t) => t.name));
      const hits = expectedTools.filter((t) => called.has(t));
      toolCoverage = hits.length / expectedTools.length;
      if (toolCoverage < 1) {
        const missing = expectedTools.filter((t) => !called.has(t));
        notes.push(`missing expected tool calls: ${missing.join(", ")}`);
      }
    }
    // For non-agent runners, tool coverage is "n/a" — score as 1 so it
    // doesn't drag their aggregate. The comparison that matters is
    // agent-vs-agent and agent-vs-single-shot on substring+no_halluc.
  }

  const producedOutput =
    result.errored || result.text.trim().length === 0 ? 0 : 1;
  if (result.errored) {
    notes.push(`errored: ${result.errorReason ?? "unknown"}`);
  }
  if (!result.errored && result.text.trim().length === 0) {
    notes.push(`empty output`);
  }

  const aggregate =
    (substringCoverage + noHallucination + toolCoverage + producedOutput) / 4;

  return {
    runner: result.runner,
    questionId: question.id,
    rubric: {
      substring_coverage: round(substringCoverage),
      no_hallucination: round(noHallucination),
      tool_coverage: round(toolCoverage),
      produced_output: round(producedOutput),
      aggregate_rules: round(aggregate),
    },
    notes,
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

// ---------------------------------------------------------------------------
// Optional judge-model scorer
// ---------------------------------------------------------------------------

const JUDGE_SYSTEM_PROMPT =
  "You are evaluating Clash Royale coaching responses. Score the given response " +
  "on a 0..10 scale across three dimensions: specificity (does it cite concrete " +
  "numbers/cards/matchups?), correctness (is the advice consistent with the " +
  "question and the player data?), actionability (can the player do something " +
  'concrete after reading?). Return ONLY a JSON object: {"specificity": n, ' +
  '"correctness": n, "actionability": n, "rationale": "one-line reason"}.';

interface JudgeRaw {
  specificity: number;
  correctness: number;
  actionability: number;
  rationale: string;
}

export async function judgeWithModel(
  env: Env,
  question: EvalQuestion,
  result: RunResult,
): Promise<{ score: number; rationale: string } | null> {
  if (!env.ANTHROPIC_API_KEY) return null;
  if (result.errored || !result.text) return null;

  const model = env.ANTHROPIC_MODEL?.trim() || "claude-sonnet-4-20250514";
  const payload = {
    question: question.question,
    player_tag: question.playerTag,
    response: result.text,
  };

  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: 200,
        system: JUDGE_SYSTEM_PROMPT,
        messages: [{ role: "user", content: JSON.stringify(payload) }],
      }),
    });
  } catch {
    return null;
  }

  if (!response.ok) return null;

  const body = (await response.json()) as unknown;
  if (typeof body !== "object" || body === null || !("content" in body)) {
    return null;
  }
  const content = (body as { content: unknown }).content;
  if (!Array.isArray(content)) return null;
  const text = content
    .flatMap((block) =>
      typeof block === "object" &&
      block !== null &&
      "text" in block &&
      typeof (block as { text: unknown }).text === "string"
        ? [(block as { text: string }).text]
        : [],
    )
    .join("");

  // Claude sometimes wraps JSON in prose; try to extract the first JSON object.
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;
  let parsed: JudgeRaw;
  try {
    parsed = JSON.parse(jsonMatch[0]) as JudgeRaw;
  } catch {
    return null;
  }
  const specificity = Number(parsed.specificity) || 0;
  const correctness = Number(parsed.correctness) || 0;
  const actionability = Number(parsed.actionability) || 0;
  const aggregate = (specificity + correctness + actionability) / 30; // normalize 0..10 each, 0..1 total
  return {
    score: round(Math.min(1, Math.max(0, aggregate))),
    rationale: parsed.rationale ?? "",
  };
}
