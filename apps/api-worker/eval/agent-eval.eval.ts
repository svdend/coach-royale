/**
 * @fileoverview Agent quality eval (AG6, cr-c0y).
 *
 * Runs the three backends (agent-anthropic, single-shot-anthropic,
 * deterministic) against the fixture set and writes a markdown + JSON
 * report under apps/api-worker/eval/reports/.
 *
 * This file uses the .eval.ts suffix so the default vitest include
 * (tests/**\/*.test.ts) ignores it. Invoke via:
 *
 *   npm run eval:agent --prefix apps/api-worker
 *
 * Environment:
 *   ANTHROPIC_API_KEY — required for agent/single-shot runs; without
 *                       it, only the deterministic runner produces
 *                       output and the harness verifies plumbing.
 *   ANTHROPIC_MODEL   — optional override, defaults to claude-sonnet-4.
 *   EVAL_USE_JUDGE    — "true" to also call the judge-model scorer
 *                       (uses Anthropic; costs tokens). Default off.
 *   EVAL_REPORT_DIR   — output directory. Default: eval/reports/
 *                       (relative to apps/api-worker).
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import { ruleBasedJudge, judgeWithModel, type ScoreResult } from "./judge";
import {
  renderMarkdownReport,
  summarize,
  writeJsonReport,
  writeMarkdownReport,
  type ReportRow,
} from "./report";
import {
  runAgentAnthropic,
  runDeterministic,
  runSingleShotAnthropic,
  type EvalQuestion,
  type RunResult,
  type RunnerId,
} from "./runners";
import type { Env } from "../src/types";

interface FixtureFile {
  questions: EvalQuestion[];
}

const FIXTURE_PATH = join(
  import.meta.dirname ?? __dirname,
  "fixtures",
  "coaching-questions.json",
);

const REPORT_DIR =
  process.env.EVAL_REPORT_DIR ??
  join(import.meta.dirname ?? __dirname, "reports");

const USE_JUDGE = process.env.EVAL_USE_JUDGE === "true";

function envFromProcess(): Env {
  return {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
    RELAY_BASE_URL: "https://eval-relay.invalid",
    RELAY_SHARED_SECRET: "eval-stub",
  };
}

async function runQuestion(
  env: Env,
  question: EvalQuestion,
): Promise<ReportRow> {
  // Run backends serially to keep Anthropic rate-limit pressure low
  // and to make latency numbers interpretable (no shared-thread jitter).
  const agent = await runAgentAnthropic(question, env);
  const single = await runSingleShotAnthropic(question, env);
  const det = await runDeterministic(question, env);

  const results = new Map<RunnerId, RunResult>([
    ["agent-anthropic", agent],
    ["single-shot-anthropic", single],
    ["deterministic", det],
  ]);

  const scores = new Map<RunnerId, ScoreResult>();
  for (const [runner, result] of results) {
    scores.set(runner, ruleBasedJudge(question, result));
  }

  const judgeScores = new Map<RunnerId, { score: number; rationale: string }>();
  if (USE_JUDGE) {
    for (const [runner, result] of results) {
      const judged = await judgeWithModel(env, question, result);
      if (judged) judgeScores.set(runner, judged);
    }
  }

  return {
    question,
    results,
    scores,
    judgeScores: judgeScores.size > 0 ? judgeScores : undefined,
  };
}

describe("agent eval harness", () => {
  it(
    "runs the full fixture set and writes a markdown + JSON report",
    async () => {
      const env = envFromProcess();
      const fixture = JSON.parse(
        readFileSync(FIXTURE_PATH, "utf8"),
      ) as FixtureFile;

      const rows: ReportRow[] = [];
      for (const question of fixture.questions) {
        const row = await runQuestion(env, question);
        rows.push(row);
      }

      const stamp = new Date()
        .toISOString()
        .replace(/[:.]/g, "-")
        .replace(/Z$/, "");
      writeMarkdownReport(rows, join(REPORT_DIR, `agent-eval-${stamp}.md`));
      writeJsonReport(rows, join(REPORT_DIR, `agent-eval-${stamp}.json`));

      // Console summary for quick CI inspection.
      const markdown = renderMarkdownReport(rows);
      const firstSummary = markdown
        .split("\n## ")
        .find((section) => section.startsWith("Summary"));
      if (firstSummary) {
        console.log("\n=== " + firstSummary);
      }

      const summary = summarize(rows, [
        "agent-anthropic",
        "single-shot-anthropic",
        "deterministic",
      ]);

      // Sanity check: every backend produced at least one row (including
      // error rows when the key is missing — those are still rows).
      expect(rows).toHaveLength(fixture.questions.length);
      expect(summary.size).toBeGreaterThan(0);
    },
    // Generous timeout: Anthropic can be slow, and we run 8 fixtures
    // across 2 paid runners serially.
    10 * 60_000,
  );
});
