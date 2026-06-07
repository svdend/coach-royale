/**
 * Unit tests for the eval report writer (AG6).
 */

import { describe, expect, it } from "vitest";

import { renderMarkdownReport, summarize, type ReportRow } from "../report";
import { ruleBasedJudge } from "../judge";
import type { EvalQuestion, RunResult, RunnerId } from "../runners";

function row(id: string, entries: [RunnerId, RunResult][]): ReportRow {
  const question: EvalQuestion = {
    id,
    playerTag: "#T",
    question: `Q ${id}`,
    fixture: { player: { tag: "#T" } },
  };
  const results = new Map(entries);
  const scores = new Map(
    entries.map(([runner, result]) => [
      runner,
      ruleBasedJudge(question, result),
    ]),
  );
  return { question, results, scores };
}

function result(runner: RunnerId, overrides: Partial<RunResult>): RunResult {
  return {
    runner,
    questionId: "q",
    text: "answer",
    latencyMs: 100,
    toolCalls: [],
    errored: false,
    ...overrides,
  };
}

describe("summarize", () => {
  it("computes completion count and mean rule score per runner", () => {
    const rows = [
      row("a", [
        ["agent-anthropic", result("agent-anthropic", { text: "ok" })],
        ["deterministic", result("deterministic", { text: "ok" })],
      ]),
      row("b", [
        [
          "agent-anthropic",
          result("agent-anthropic", { errored: true, text: "" }),
        ],
        ["deterministic", result("deterministic", { text: "ok" })],
      ]),
    ];
    const summary = summarize(rows, [
      "agent-anthropic",
      "single-shot-anthropic",
      "deterministic",
    ]);
    expect(summary.get("agent-anthropic")?.completed).toBe(1);
    expect(summary.get("deterministic")?.completed).toBe(2);
    // single-shot-anthropic never appeared -> not in summary
    expect(summary.has("single-shot-anthropic")).toBe(false);
  });

  it("computes median latency and total tool-call count", () => {
    const rows = [
      row("a", [
        [
          "agent-anthropic",
          result("agent-anthropic", {
            latencyMs: 100,
            toolCalls: [{ name: "t1", latencyMs: 50, isError: false }],
          }),
        ],
      ]),
      row("b", [
        [
          "agent-anthropic",
          result("agent-anthropic", {
            latencyMs: 300,
            toolCalls: [
              { name: "t1", latencyMs: 50, isError: false },
              { name: "t2", latencyMs: 60, isError: false },
            ],
          }),
        ],
      ]),
      row("c", [
        [
          "agent-anthropic",
          result("agent-anthropic", { latencyMs: 500, toolCalls: [] }),
        ],
      ]),
    ];
    const s = summarize(rows, ["agent-anthropic"]);
    expect(s.get("agent-anthropic")?.medianLatencyMs).toBe(300);
    expect(s.get("agent-anthropic")?.totalToolCalls).toBe(3);
  });
});

describe("renderMarkdownReport", () => {
  it("renders a summary header with the expected runners", () => {
    const rows = [
      row("q1", [
        ["agent-anthropic", result("agent-anthropic", { text: "alpha" })],
        [
          "single-shot-anthropic",
          result("single-shot-anthropic", { text: "beta" }),
        ],
        ["deterministic", result("deterministic", { text: "gamma" })],
      ]),
    ];
    const md = renderMarkdownReport(rows);
    expect(md).toContain("# Agent Eval Report");
    expect(md).toContain("| `agent-anthropic` |");
    expect(md).toContain("| `single-shot-anthropic` |");
    expect(md).toContain("| `deterministic` |");
    expect(md).toContain("### q1");
  });

  it("shows errored runs with an errored marker and no response body", () => {
    const rows = [
      row("q1", [
        [
          "agent-anthropic",
          result("agent-anthropic", {
            text: "",
            errored: true,
            errorReason: "anthropic_error",
          }),
        ],
      ]),
    ];
    const md = renderMarkdownReport(rows);
    expect(md).toContain("errored");
    expect(md).toContain("anthropic_error");
  });

  it("lists tool calls under the agent section when present", () => {
    const rows = [
      row("q1", [
        [
          "agent-anthropic",
          result("agent-anthropic", {
            text: "done",
            toolCalls: [
              { name: "get_player_profile", latencyMs: 42, isError: false },
            ],
          }),
        ],
      ]),
    ];
    const md = renderMarkdownReport(rows);
    expect(md).toContain("get_player_profile");
    expect(md).toContain("42ms");
  });
});
