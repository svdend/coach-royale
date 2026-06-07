/**
 * @fileoverview Markdown + JSON report writer for the eval harness
 * (AG6, cr-c0y).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import type { EvalQuestion, RunResult, RunnerId } from "./runners";
import type { ScoreResult } from "./judge";

export interface ReportRow {
  question: EvalQuestion;
  results: Map<RunnerId, RunResult>;
  scores: Map<RunnerId, ScoreResult>;
  judgeScores?: Map<RunnerId, { score: number; rationale: string }>;
}

function writeFileSyncWithDirs(filePath: string, content: string): void {
  mkdirSync(dirname(resolve(filePath)), { recursive: true });
  writeFileSync(resolve(filePath), content, "utf8");
}

export function writeJsonReport(rows: ReportRow[], outputPath: string): void {
  const payload = rows.map((row) => ({
    question: {
      id: row.question.id,
      player_tag: row.question.playerTag,
      question: row.question.question,
    },
    runs: Object.fromEntries(
      Array.from(row.results.entries()).map(([runner, result]) => [
        runner,
        {
          text: result.text,
          latency_ms: result.latencyMs,
          turns: result.turns,
          tokens: result.tokens,
          tool_calls: result.toolCalls,
          errored: result.errored,
          error_reason: result.errorReason,
          rule_score: row.scores.get(runner)?.rubric,
          rule_notes: row.scores.get(runner)?.notes,
          judge: row.judgeScores?.get(runner),
        },
      ]),
    ),
  }));
  writeFileSyncWithDirs(outputPath, JSON.stringify(payload, null, 2));
}

/**
 * Renders a human-readable markdown report. Structure:
 *   - summary table: per-runner aggregate rule score + median latency
 *   - per-question section with each runner's text + score breakdown
 */
export function renderMarkdownReport(rows: ReportRow[]): string {
  const runners: RunnerId[] = [
    "agent-anthropic",
    "single-shot-anthropic",
    "deterministic",
  ];

  const summary = summarize(rows, runners);
  const lines: string[] = [];
  lines.push("# Agent Eval Report");
  lines.push("");
  lines.push(`Generated: ${new Date().toISOString()}`);
  lines.push("");
  lines.push(`Total questions: ${rows.length}`);
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(
    "| Runner | Completed | Mean rule score | Median latency (ms) | Mean tokens (in/out) | Mean turns | Tool calls |",
  );
  lines.push("|---|---|---|---|---|---|---|");
  for (const runner of runners) {
    const s = summary.get(runner);
    if (!s) continue;
    lines.push(
      `| \`${runner}\` | ${s.completed}/${rows.length} | ${s.meanRuleScore.toFixed(2)} | ${s.medianLatencyMs} | ${s.meanInputTokens}/${s.meanOutputTokens} | ${s.meanTurns.toFixed(1)} | ${s.totalToolCalls} |`,
    );
  }
  lines.push("");

  const anyJudge = rows.some((row) => (row.judgeScores?.size ?? 0) > 0);
  if (anyJudge) {
    lines.push("### Judge-model scores");
    lines.push("");
    lines.push("| Runner | Mean judge score (0..1) |");
    lines.push("|---|---|");
    for (const runner of runners) {
      const scores = rows
        .map((row) => row.judgeScores?.get(runner)?.score)
        .filter((s): s is number => typeof s === "number");
      if (scores.length === 0) continue;
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      lines.push(`| \`${runner}\` | ${mean.toFixed(2)} |`);
    }
    lines.push("");
  }

  lines.push("## Per-question detail");
  lines.push("");
  for (const row of rows) {
    lines.push(`### ${row.question.id}: ${row.question.question}`);
    lines.push("");
    lines.push(`Player tag: \`${row.question.playerTag}\``);
    lines.push("");
    for (const runner of runners) {
      const result = row.results.get(runner);
      const score = row.scores.get(runner);
      if (!result || !score) continue;
      lines.push(`#### \`${runner}\``);
      lines.push("");
      if (result.errored) {
        lines.push(`> **errored**: ${result.errorReason ?? "unknown"}`);
        lines.push("");
        continue;
      }
      lines.push(
        `latency: ${result.latencyMs}ms | rule score: ${score.rubric.aggregate_rules} (substring=${score.rubric.substring_coverage}, tools=${score.rubric.tool_coverage})`,
      );
      if (result.tokens) {
        lines.push(
          `tokens: ${result.tokens.input} in / ${result.tokens.output} out`,
        );
      }
      if (result.toolCalls.length > 0) {
        lines.push("tool calls:");
        for (const tc of result.toolCalls) {
          lines.push(
            `  - ${tc.name} (${tc.latencyMs}ms)${tc.isError ? " ❗" : ""}`,
          );
        }
      }
      if (score.notes.length > 0) {
        lines.push("notes:");
        for (const note of score.notes) lines.push(`  - ${note}`);
      }
      const judgeScore = row.judgeScores?.get(runner);
      if (judgeScore) {
        lines.push(
          `judge: ${judgeScore.score.toFixed(2)} — ${judgeScore.rationale}`,
        );
      }
      lines.push("");
      lines.push("<details><summary>response text</summary>");
      lines.push("");
      lines.push("```");
      lines.push(result.text || "(empty)");
      lines.push("```");
      lines.push("");
      lines.push("</details>");
      lines.push("");
    }
  }

  return lines.join("\n");
}

interface RunnerSummary {
  completed: number;
  meanRuleScore: number;
  medianLatencyMs: number;
  meanInputTokens: number;
  meanOutputTokens: number;
  meanTurns: number;
  totalToolCalls: number;
}

export function summarize(
  rows: ReportRow[],
  runners: RunnerId[],
): Map<RunnerId, RunnerSummary> {
  const out = new Map<RunnerId, RunnerSummary>();
  for (const runner of runners) {
    const results = rows
      .map((r) => r.results.get(runner))
      .filter((r): r is RunResult => r !== undefined);
    if (results.length === 0) continue;

    const completed = results.filter((r) => !r.errored).length;
    const scores = rows
      .map((r) => r.scores.get(runner)?.rubric.aggregate_rules)
      .filter((s): s is number => typeof s === "number");
    const meanRuleScore =
      scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const latencies = results.map((r) => r.latencyMs).sort((a, b) => a - b);
    const medianLatencyMs = latencies[Math.floor(latencies.length / 2)] ?? 0;
    const inputTokens = results
      .map((r) => r.tokens?.input ?? 0)
      .filter((t) => t > 0);
    const outputTokens = results
      .map((r) => r.tokens?.output ?? 0)
      .filter((t) => t > 0);
    const meanInputTokens =
      inputTokens.length > 0
        ? Math.round(
            inputTokens.reduce((a, b) => a + b, 0) / inputTokens.length,
          )
        : 0;
    const meanOutputTokens =
      outputTokens.length > 0
        ? Math.round(
            outputTokens.reduce((a, b) => a + b, 0) / outputTokens.length,
          )
        : 0;
    const turns = results.map((r) => r.turns ?? 0).filter((t) => t > 0);
    const meanTurns =
      turns.length > 0 ? turns.reduce((a, b) => a + b, 0) / turns.length : 0;
    const totalToolCalls = results.reduce(
      (acc, r) => acc + r.toolCalls.length,
      0,
    );

    out.set(runner, {
      completed,
      meanRuleScore,
      medianLatencyMs,
      meanInputTokens,
      meanOutputTokens,
      meanTurns,
      totalToolCalls,
    });
  }
  return out;
}

export function writeMarkdownReport(
  rows: ReportRow[],
  outputPath: string,
): void {
  writeFileSyncWithDirs(outputPath, renderMarkdownReport(rows));
}
