/**
 * Tests for the agent tool registry (AG2, cr-8jb).
 *
 * Covers:
 *   - Every tool has an Anthropic schema + Zod validator.
 *   - Zod rejects malformed input for each tool (unknown field, wrong type,
 *     out-of-range value) before dispatch.
 *   - Dispatch composes existing Worker lib functions (relay + analytics),
 *     which are mocked via fetch so tests never hit the network.
 *   - Unknown tool name raises UnknownToolError.
 *   - A fabricated player tag supplied by the caller in the input is
 *     rejected (the model cannot override the session's playerTag).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ToolInputError,
  UnknownToolError,
  dispatchTool,
  getToolDefinition,
  toolSchemas,
  validateToolInput,
  type ToolContext,
  type ToolName,
} from "../src/lib/tools";
import type { Env, RawBattle } from "../src/types";

const BASE_ENV: Env = {
  RELAY_BASE_URL: "https://relay.example.com",
  RELAY_SHARED_SECRET: "relay-secret",
};

const BASE_CONTEXT: ToolContext = {
  env: BASE_ENV,
  playerTag: "#ABC123",
  requestId: "req-test",
};

/**
 * Shared fetch mock helper. Different tools hit different relay paths
 * (/api/v1/players/<tag> vs /api/v1/players/<tag>/battles vs
 * /api/v1/clans/<tag>). The mock routes by URL substring.
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
      // Relay URL shape is /relay/player/<tag> and /relay/player/<tag>/battles
      // Check battles before player so /battles doesn't fall through to player.
      if (href.includes("/relay/player/") && href.includes("/battles")) {
        return new Response(JSON.stringify(behavior.battles ?? []), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (href.includes("/relay/clan/")) {
        return new Response(JSON.stringify(behavior.clan ?? {}), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (href.includes("/relay/player/")) {
        return new Response(JSON.stringify(behavior.player ?? {}), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`unexpected fetch: ${href}`);
    },
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/**
 * Minimal fake battle in the shape returned by the Supercell API, good
 * enough for normalizeBattle to produce a NormalizedBattle for the
 * context's player tag.
 */
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

function fakeBattle(overrides?: Partial<RawBattle>): RawBattle {
  return {
    type: "PvP",
    battleTime: "20260101T120000.000Z",
    gameMode: { id: 72000006, name: "Ladder" },
    team: [
      {
        tag: BASE_CONTEXT.playerTag,
        name: "Op",
        crowns: 1,
        trophyChange: 30,
        startingTrophies: 6000,
        cards: fakeCards(),
      },
    ],
    opponent: [
      {
        tag: "#OPP1",
        name: "Enemy",
        crowns: 0,
        trophyChange: -30,
        startingTrophies: 6000,
        cards: fakeCards(),
      },
    ],
    ...overrides,
  };
}

describe("tool registry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("registry surface", () => {
    it("exposes exactly the six read-only tools", () => {
      const names = toolSchemas.map((schema) => schema.name).sort();
      expect(names).toEqual(
        [
          "get_clan_info",
          "get_deck_stats",
          "get_matchup_breakdown",
          "get_player_analytics",
          "get_player_profile",
          "get_recent_battles",
        ].sort(),
      );
    });

    it("every tool schema has a description and additionalProperties:false", () => {
      for (const schema of toolSchemas) {
        expect(schema.description.length).toBeGreaterThan(30);
        expect(schema.input_schema.additionalProperties).toBe(false);
      }
    });
  });

  describe("validateToolInput", () => {
    it("rejects an unknown tool name", () => {
      expect(() => validateToolInput("drop_table_users", {})).toThrow(
        UnknownToolError,
      );
    });

    it("accepts empty input for no-arg tools", () => {
      for (const name of [
        "get_player_profile",
        "get_player_analytics",
        "get_deck_stats",
        "get_clan_info",
      ] satisfies ToolName[]) {
        expect(() => validateToolInput(name, {})).not.toThrow();
      }
    });

    it("rejects unknown fields in no-arg tools (strict Zod)", () => {
      expect(() =>
        validateToolInput("get_player_profile", { player_tag: "#HACK" }),
      ).toThrow(ToolInputError);
    });

    it("accepts valid get_recent_battles filters", () => {
      expect(() =>
        validateToolInput("get_recent_battles", {
          result: "defeat",
          game_mode_contains: "ladder",
          limit: 10,
        }),
      ).not.toThrow();
    });

    it("rejects get_recent_battles with an invalid enum", () => {
      expect(() =>
        validateToolInput("get_recent_battles", { result: "ok" }),
      ).toThrow(ToolInputError);
    });

    it("rejects get_recent_battles with an out-of-range limit", () => {
      expect(() =>
        validateToolInput("get_recent_battles", { limit: 100 }),
      ).toThrow(ToolInputError);
      expect(() =>
        validateToolInput("get_recent_battles", { limit: 0 }),
      ).toThrow(ToolInputError);
    });

    it("rejects get_matchup_breakdown with a non-integer min_games", () => {
      expect(() =>
        validateToolInput("get_matchup_breakdown", { min_games: 2.5 }),
      ).toThrow(ToolInputError);
    });

    it("ToolInputError surfaces the Zod issues for diagnostics", () => {
      try {
        validateToolInput("get_recent_battles", { limit: 999 });
      } catch (error) {
        expect(error).toBeInstanceOf(ToolInputError);
        const toolError = error as ToolInputError;
        expect(toolError.toolName).toBe("get_recent_battles");
        expect(toolError.issues.length).toBeGreaterThan(0);
      }
    });
  });

  describe("dispatchTool — get_player_profile", () => {
    it("returns a compact profile shape from relay player data", async () => {
      installRelayFetch({
        player: {
          tag: BASE_CONTEXT.playerTag,
          name: "Op",
          trophies: 6250,
          bestTrophies: 7200,
          expLevel: 14,
          arena: { id: 54000019, name: "Legendary Arena" },
          clan: { tag: "#CLAN", name: "Coaches", role: "leader" },
          wins: 1200,
          losses: 1100,
          battleCount: 3400,
          threeCrownWins: 250,
          currentDeck: [{ name: "Hog Rider" }, { name: "Mega Knight" }],
        },
      });
      const out = (await dispatchTool(
        BASE_CONTEXT,
        "get_player_profile",
        {},
      )) as { tag: string; name?: string; trophies?: number };
      expect(out.tag).toBe(BASE_CONTEXT.playerTag);
      expect(out.name).toBe("Op");
      expect(out.trophies).toBe(6250);
    });
  });

  describe("dispatchTool — get_recent_battles", () => {
    it("returns all battles unfiltered with a limit of 25 by default", async () => {
      const battles = Array.from({ length: 5 }, () => fakeBattle());
      installRelayFetch({ battles });
      const out = (await dispatchTool(
        BASE_CONTEXT,
        "get_recent_battles",
        {},
      )) as { count: number; battles: unknown[] };
      expect(out.count).toBe(5);
    });

    it("filters by result", async () => {
      const battles: RawBattle[] = [
        // win
        fakeBattle(),
        // loss: swap crown counts
        fakeBattle({
          team: [
            {
              tag: BASE_CONTEXT.playerTag,
              name: "Op",
              crowns: 0,
              trophyChange: -30,
              cards: fakeCards(),
            },
          ],
          opponent: [
            {
              tag: "#OPP2",
              name: "Enemy",
              crowns: 2,
              trophyChange: 30,
              cards: fakeCards(),
            },
          ],
        }),
      ];
      installRelayFetch({ battles });
      const out = (await dispatchTool(BASE_CONTEXT, "get_recent_battles", {
        result: "defeat",
      })) as { count: number };
      expect(out.count).toBe(1);
    });

    it("filters by game_mode substring (case-insensitive)", async () => {
      const battles = [
        fakeBattle({ gameMode: { id: 1, name: "Challenge Grand" } }),
        fakeBattle({ gameMode: { id: 2, name: "Ladder" } }),
      ];
      installRelayFetch({ battles });
      const out = (await dispatchTool(BASE_CONTEXT, "get_recent_battles", {
        game_mode_contains: "CHALLENGE",
      })) as { count: number };
      expect(out.count).toBe(1);
    });

    it("honors the limit argument", async () => {
      installRelayFetch({
        battles: Array.from({ length: 10 }, () => fakeBattle()),
      });
      const out = (await dispatchTool(BASE_CONTEXT, "get_recent_battles", {
        limit: 3,
      })) as { count: number };
      expect(out.count).toBe(3);
    });
  });

  describe("dispatchTool — get_player_analytics", () => {
    it("returns a PlayerState with win_rate_overall computed from battles", async () => {
      installRelayFetch({
        player: { tag: BASE_CONTEXT.playerTag, trophies: 6000 },
        battles: [fakeBattle(), fakeBattle(), fakeBattle()],
      });
      const out = (await dispatchTool(
        BASE_CONTEXT,
        "get_player_analytics",
        {},
      )) as { win_rate_overall: number };
      expect(out.win_rate_overall).toBe(1);
    });
  });

  describe("dispatchTool — get_deck_stats", () => {
    it("returns the four deck-stability fields", async () => {
      installRelayFetch({
        player: { tag: BASE_CONTEXT.playerTag, trophies: 6000 },
        battles: [fakeBattle()],
      });
      const out = (await dispatchTool(BASE_CONTEXT, "get_deck_stats", {})) as {
        deck_stability_score: number;
        unique_decks_last_20: number;
      };
      expect(typeof out.deck_stability_score).toBe("number");
      expect(typeof out.unique_decks_last_20).toBe("number");
    });
  });

  describe("dispatchTool — get_matchup_breakdown", () => {
    it("returns worst, best, and filtered arrays", async () => {
      installRelayFetch({
        player: { tag: BASE_CONTEXT.playerTag, trophies: 6000 },
        battles: [fakeBattle()],
      });
      const out = (await dispatchTool(BASE_CONTEXT, "get_matchup_breakdown", {
        min_games: 1,
      })) as {
        worst_matchups: unknown[];
        best_matchups: unknown[];
        filtered: unknown[];
      };
      expect(Array.isArray(out.worst_matchups)).toBe(true);
      expect(Array.isArray(out.best_matchups)).toBe(true);
      expect(Array.isArray(out.filtered)).toBe(true);
    });
  });

  describe("dispatchTool — get_clan_info", () => {
    it("returns an empty object when the player has no clan", async () => {
      installRelayFetch({
        player: { tag: BASE_CONTEXT.playerTag, trophies: 6000 },
      });
      const out = (await dispatchTool(
        BASE_CONTEXT,
        "get_clan_info",
        {},
      )) as Record<string, unknown>;
      expect(Object.keys(out)).toHaveLength(0);
    });

    it("returns clan details when the player is in a clan", async () => {
      installRelayFetch({
        player: {
          tag: BASE_CONTEXT.playerTag,
          trophies: 6000,
          clan: { tag: "#CLAN1" },
        },
        clan: {
          tag: "#CLAN1",
          name: "Coaches",
          description: "We coach.",
          type: "open",
          members: 45,
          clanWarTrophies: 3200,
          requiredTrophies: 5000,
          donationsPerWeek: 8000,
        },
      });
      const out = (await dispatchTool(BASE_CONTEXT, "get_clan_info", {})) as {
        name?: string;
        members?: number;
      };
      expect(out.name).toBe("Coaches");
      expect(out.members).toBe(45);
    });
  });

  describe("getToolDefinition", () => {
    it("exposes the tool definition for each registered name", () => {
      const def = getToolDefinition("get_player_profile");
      expect(def.name).toBe("get_player_profile");
      expect(def.schema.name).toBe("get_player_profile");
    });
  });
});
