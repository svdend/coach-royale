/**
 * Tests for the dispatcher wiring of the custom provider (P1.3).
 *
 * These tests exercise generateAnalysisText / generateQuickResponse /
 * generateWeeklyPlan / answerCoachQuestion with provider='custom' and
 * verify that:
 *   - success path returns custom-model text without touching Anthropic
 *   - failure path falls back to Anthropic silently
 *   - telemetry.fallback_used is populated correctly in both cases
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  answerCoachQuestion,
  generateAnalysisText,
  generateQuickResponse,
  generateWeeklyPlan,
} from "../src/lib/ai";
import type { Env, NormalizedBattle, PlayerState } from "../src/types";

const customEnv: Env = {
  CUSTOM_MODEL_URL: "https://garage.example.com/v1",
  CUSTOM_MODEL_KEY: "k",
  CUSTOM_MODEL_NAME: "coachroyale-ft-v1",
  ANTHROPIC_API_KEY: "sk-ant-test",
  ANTHROPIC_MODEL: "claude-test",
};

const baseState: PlayerState = {
  player_tag: "#ABC",
  trophies: 6200,
  total_battles: 500,
  battles_analyzed: 50,
  win_rate_last_10: 0.6,
  win_rate_last_20: 0.55,
  win_rate_last_50: 0.52,
  win_rate_overall: 0.5,
  trend_direction: "plateau",
  trend_strength: 0.2,
  trend_confidence: "low",
  trophy_delta_7d: 50,
  best_deck: null,
  worst_deck: null,
  deck_stability_score: 0.4,
  unique_decks_last_20: 4,
  worst_matchups: [],
  best_matchups: [],
  tilt_win_rate: null,
  baseline_win_rate: 0.5,
  tilt_impact: null,
  tilt_confidence: "low",
  best_time_slot: null,
  worst_time_slot: null,
  time_slot_data: {},
  win_rate_variance: 0.1,
  result_volatility: "low",
};

/**
 * Builds a fetch mock that returns a different response depending on which
 * upstream is being hit. Custom model hits /chat/completions; Anthropic hits
 * api.anthropic.com. This lets us simulate "custom fails, anthropic succeeds"
 * without race conditions.
 */
function installMixedFetch(behavior: {
  custom: "ok" | "fail";
  customText?: string;
  /** Optional — only set if the test expects Anthropic fallback to fire. */
  anthropic?: "ok" | "fail";
  anthropicText?: string;
}) {
  const fetchMock = vi.fn(async (url: string | URL | Request) => {
    const href =
      typeof url === "string" ? url : url instanceof URL ? url.href : url.url;
    if (href.includes("garage.example.com")) {
      if (behavior.custom === "fail") {
        return new Response("garage down", { status: 503 });
      }
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: behavior.customText ?? "custom says hi",
              },
            },
          ],
        }),
        { status: 200 },
      );
    }
    if (href.includes("api.anthropic.com")) {
      if (behavior.anthropic === "fail") {
        return new Response("anthropic down", { status: 500 });
      }
      return new Response(
        JSON.stringify({
          content: [
            {
              type: "text",
              text: behavior.anthropicText ?? "anthropic says hi",
            },
          ],
        }),
        { status: 200 },
      );
    }
    throw new Error(`unexpected fetch: ${href}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("dispatcher: provider='custom' branch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("generateAnalysisText", () => {
    it("returns custom text and marks fallback_used=false on success", async () => {
      installMixedFetch({ custom: "ok", customText: "ft-analysis" });
      const telemetry: { fallback_used?: boolean } = {};
      const text = await generateAnalysisText(
        customEnv,
        { name: "op", tag: "#A" },
        baseState,
        [] as NormalizedBattle[],
        { provider: "custom", telemetry },
      );
      expect(text).toBe("ft-analysis");
      expect(telemetry.fallback_used).toBe(false);
    });

    it("falls back to Anthropic and marks fallback_used=true when custom fails", async () => {
      installMixedFetch({
        custom: "fail",
        anthropic: "ok",
        anthropicText: "claude-analysis",
      });
      const telemetry: { fallback_used?: boolean } = {};
      const text = await generateAnalysisText(
        customEnv,
        { name: "op", tag: "#A" },
        baseState,
        [] as NormalizedBattle[],
        { provider: "custom", telemetry },
      );
      expect(text).toBe("claude-analysis");
      expect(telemetry.fallback_used).toBe(true);
    });
  });

  describe("generateQuickResponse", () => {
    it("returns custom text on success", async () => {
      installMixedFetch({ custom: "ok", customText: "quick-ft" });
      const telemetry: { fallback_used?: boolean } = {};
      const text = await generateQuickResponse(
        customEnv,
        "What deck?",
        { name: "op" },
        "deck_tips",
        { provider: "custom", telemetry },
      );
      expect(text).toBe("quick-ft");
      expect(telemetry.fallback_used).toBe(false);
    });

    it("falls back to Anthropic when custom returns non-OK", async () => {
      installMixedFetch({
        custom: "fail",
        anthropic: "ok",
        anthropicText: "quick-claude",
      });
      const telemetry: { fallback_used?: boolean } = {};
      const text = await generateQuickResponse(
        customEnv,
        "What deck?",
        { name: "op" },
        "deck_tips",
        { provider: "custom", telemetry },
      );
      expect(text).toBe("quick-claude");
      expect(telemetry.fallback_used).toBe(true);
    });
  });

  describe("answerCoachQuestion", () => {
    it("returns custom text on success", async () => {
      installMixedFetch({ custom: "ok", customText: "coach-ft" });
      const telemetry: { fallback_used?: boolean } = {};
      const text = await answerCoachQuestion(
        customEnv,
        "How do I beat X.Bow?",
        baseState,
        { provider: "custom", telemetry },
      );
      expect(text).toBe("coach-ft");
      expect(telemetry.fallback_used).toBe(false);
    });

    it("falls back to Anthropic on custom failure", async () => {
      installMixedFetch({
        custom: "fail",
        anthropic: "ok",
        anthropicText: "coach-claude",
      });
      const telemetry: { fallback_used?: boolean } = {};
      const text = await answerCoachQuestion(
        customEnv,
        "How do I beat X.Bow?",
        baseState,
        { provider: "custom", telemetry },
      );
      expect(text).toBe("coach-claude");
      expect(telemetry.fallback_used).toBe(true);
    });
  });

  describe("generateWeeklyPlan", () => {
    it("parses JSON from custom model when provider='custom'", async () => {
      const validJson = JSON.stringify({
        coaching_summary: "s",
        performance_verdict: "v",
        confidence: "c",
        top_priority: {
          title: "t",
          description: "d",
          evidence: "e",
          expected_impact: "i",
        },
        weekly_goals: [],
        drills: [],
        deck_recommendation: {
          verdict: "x",
          reasoning: "y",
          suggested_swap: null,
        },
        matchup_alerts: [],
        tilt_note: null,
        confidence_builders: [],
      });
      installMixedFetch({ custom: "ok", customText: validJson });
      const telemetry: { fallback_used?: boolean } = {};
      const plan = await generateWeeklyPlan(customEnv, baseState, {
        provider: "custom",
        telemetry,
      });
      expect(plan.coaching_summary).toBe("s");
      expect(telemetry.fallback_used).toBe(false);
    });

    it("falls back to Anthropic when custom fails, then default when Anthropic also fails", async () => {
      installMixedFetch({ custom: "fail", anthropic: "fail" });
      const telemetry: { fallback_used?: boolean } = {};
      const plan = await generateWeeklyPlan(customEnv, baseState, {
        provider: "custom",
        telemetry,
      });
      // Falls all the way to the hardcoded defaultPlan; we can't assert a
      // specific model text, but telemetry should reflect custom fallback.
      expect(telemetry.fallback_used).toBe(true);
      expect(plan.weekly_goals.length).toBeGreaterThan(0);
    });
  });
});
