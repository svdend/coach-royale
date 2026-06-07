/**
 * @fileoverview Agent tool registry for the Pro coaching chat (AG2, cr-8jb).
 *
 * Provides a small set of read-only tools that an Anthropic-style agent
 * loop can invoke to inspect the player's data. Each tool:
 *   1. Has an Anthropic-compatible JSON schema (used when registering
 *      the tool list with Claude).
 *   2. Validates its input with Zod before dispatch so a hallucinated
 *      or malformed tool_use block is rejected safely.
 *   3. Calls existing Worker lib functions — never talks to Supercell
 *      or Supabase directly, never writes.
 *
 * The registry is consumed by AG3 (agent orchestrator), which is not
 * implemented yet. This file stands alone and has no runtime effect
 * on the current app.
 *
 * Context shape (`ToolContext`) carries the env and the `playerTag`
 * the request is scoped to. The agent orchestrator sets `playerTag`
 * from the route (`/api/coach/agent/:tag`), so tools cannot be
 * redirected to an arbitrary player by the model.
 */

import { z } from "zod";

import { buildPlayerState } from "./analytics";
import { normalizeBattle } from "./battles";
import { fetchRelayBattles, fetchRelayClan, fetchRelayPlayer } from "./relay";
import type { Env, NormalizedBattle, PlayerState, RawBattle } from "../types";

/**
 * Runtime context passed to each tool. Kept deliberately small so the
 * agent orchestrator's contract with the registry is clear.
 *
 * `playerTag` is authoritative: the tool layer never accepts a player
 * tag from the model. This prevents prompt injection from leaking data
 * about an unrelated account.
 */
export interface ToolContext {
  env: Env;
  playerTag: string;
  requestId: string;
}

/**
 * Anthropic tool schema. Matches the shape required by
 * messages.create({tools: [...]}):
 *
 *   { name, description, input_schema: { type, properties, required } }
 *
 * Written as plain interfaces so this module stays dependency-free
 * beyond Zod (already in the project).
 */
export interface AnthropicToolSchema {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
    additionalProperties?: boolean;
  };
}

/** A single tool definition stitched together with its Zod validator and runner. */
export interface ToolDefinition<Input, Output> {
  name: string;
  schema: AnthropicToolSchema;
  input: z.ZodType<Input>;
  run: (context: ToolContext, input: Input) => Promise<Output>;
}

/** Error raised when Zod validation of a tool_use input fails. */
export class ToolInputError extends Error {
  constructor(
    public readonly toolName: string,
    public readonly issues: z.ZodIssue[],
  ) {
    super(
      `Invalid input for tool "${toolName}": ${issues
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ")}`,
    );
  }
}

/** Error raised when a tool name is not in the registry. */
export class UnknownToolError extends Error {
  constructor(public readonly toolName: string) {
    super(`Unknown tool: ${toolName}`);
  }
}

// ---------------------------------------------------------------------------
// Shared input schemas
// ---------------------------------------------------------------------------

/** Empty input schema used by no-arg tools. */
const emptyInput = z.object({}).strict();

/**
 * Optional filter for recent-battles queries. The agent can narrow to
 * wins/losses, a game mode substring, or a maximum count.
 */
const recentBattlesInput = z
  .object({
    result: z.enum(["victory", "defeat", "draw"]).optional(),
    game_mode_contains: z.string().min(1).max(64).optional(),
    limit: z.number().int().min(1).max(25).optional(),
  })
  .strict();

/** Optional archetype substring filter for matchup breakdown queries. */
const matchupBreakdownInput = z
  .object({
    archetype_contains: z.string().min(1).max(64).optional(),
    min_games: z.number().int().min(1).max(100).optional(),
  })
  .strict();

// ---------------------------------------------------------------------------
// Internal helpers (not exported)
// ---------------------------------------------------------------------------

/**
 * Fetch the recent battles for the context player and normalize them.
 * Cached on the agent orchestrator's side per turn; this function just
 * performs the relay fetch and normalization.
 */
async function loadNormalizedBattles(
  context: ToolContext,
): Promise<NormalizedBattle[]> {
  const raw = await fetchRelayBattles<RawBattle[]>(
    context.env,
    context.playerTag,
    context.requestId,
  );
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((battle) => normalizeBattle(battle, context.playerTag))
    .filter((battle): battle is NormalizedBattle => battle !== null);
}

// ---------------------------------------------------------------------------
// Tool: get_player_profile
// ---------------------------------------------------------------------------

interface PlayerProfileOutput {
  tag: string;
  name?: string;
  trophies?: number;
  best_trophies?: number;
  level?: number;
  arena?: { id?: number; name?: string };
  clan?: { tag?: string; name?: string; role?: string };
  wins?: number;
  losses?: number;
  battle_count?: number;
  three_crown_wins?: number;
  current_deck?: { name?: string }[];
}

const getPlayerProfile: ToolDefinition<
  z.infer<typeof emptyInput>,
  PlayerProfileOutput
> = {
  name: "get_player_profile",
  schema: {
    name: "get_player_profile",
    description:
      "Retrieve the current player's Clash Royale profile: name, trophies, best trophies, level, arena, clan, and the currently equipped deck. Use this for questions about the player's identity, overall standing, or current deck composition. Takes no arguments; the target player is set by the session.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  input: emptyInput,
  async run(context) {
    const raw = await fetchRelayPlayer<Record<string, unknown>>(
      context.env,
      context.playerTag,
      context.requestId,
    );
    const out: PlayerProfileOutput = {
      tag: (raw.tag as string) ?? context.playerTag,
      name: raw.name as string | undefined,
      trophies: raw.trophies as number | undefined,
      best_trophies: raw.bestTrophies as number | undefined,
      level: raw.expLevel as number | undefined,
      arena: raw.arena as PlayerProfileOutput["arena"],
      clan: raw.clan as PlayerProfileOutput["clan"],
      wins: raw.wins as number | undefined,
      losses: raw.losses as number | undefined,
      battle_count: raw.battleCount as number | undefined,
      three_crown_wins: raw.threeCrownWins as number | undefined,
      current_deck: raw.currentDeck as PlayerProfileOutput["current_deck"],
    };
    return out;
  },
};

// ---------------------------------------------------------------------------
// Tool: get_recent_battles
// ---------------------------------------------------------------------------

const getRecentBattles: ToolDefinition<
  z.infer<typeof recentBattlesInput>,
  { count: number; battles: NormalizedBattle[] }
> = {
  name: "get_recent_battles",
  schema: {
    name: "get_recent_battles",
    description:
      "List the player's recent battles (up to 25). Use this to look at specific match outcomes, decks played, opponents, or to answer questions like 'how did I lose my last 5 games?' or 'what decks am I facing in Ultimate Champion?'. Optionally filter by result (victory/defeat/draw), a game-mode substring (case-insensitive), or cap the count.",
    input_schema: {
      type: "object",
      properties: {
        result: {
          type: "string",
          enum: ["victory", "defeat", "draw"],
          description: "If set, return only battles with this result.",
        },
        game_mode_contains: {
          type: "string",
          description:
            "Case-insensitive substring match against the battle's game_mode (e.g. 'ladder', 'challenge', 'ultimate').",
        },
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 25,
          description: "Maximum number of battles to return (default 25).",
        },
      },
      additionalProperties: false,
    },
  },
  input: recentBattlesInput,
  async run(context, input) {
    const all = await loadNormalizedBattles(context);
    const modeNeedle = input.game_mode_contains?.toLowerCase();
    const filtered = all.filter((battle) => {
      if (input.result && battle.result !== input.result) return false;
      if (modeNeedle && !battle.gameMode.toLowerCase().includes(modeNeedle)) {
        return false;
      }
      return true;
    });
    const limit = input.limit ?? 25;
    const battles = filtered.slice(0, limit);
    return { count: battles.length, battles };
  },
};

// ---------------------------------------------------------------------------
// Tool: get_player_analytics
// ---------------------------------------------------------------------------

const getPlayerAnalytics: ToolDefinition<
  z.infer<typeof emptyInput>,
  PlayerState
> = {
  name: "get_player_analytics",
  schema: {
    name: "get_player_analytics",
    description:
      "Retrieve the deterministic analytics summary for the player: win rates (last 10/20/50/overall), trend direction, deck stability, worst and best matchups, tilt impact, best/worst time-of-day slots. Use this for any question about overall performance trends or to back up coaching advice with real numbers. Takes no arguments.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  input: emptyInput,
  async run(context) {
    const [rawPlayer, battles] = await Promise.all([
      fetchRelayPlayer<{ tag?: string; trophies?: number }>(
        context.env,
        context.playerTag,
        context.requestId,
      ),
      loadNormalizedBattles(context),
    ]);
    return buildPlayerState(rawPlayer, battles);
  },
};

// ---------------------------------------------------------------------------
// Tool: get_deck_stats
// ---------------------------------------------------------------------------

const getDeckStats: ToolDefinition<
  z.infer<typeof emptyInput>,
  {
    best_deck: PlayerState["best_deck"];
    worst_deck: PlayerState["worst_deck"];
    unique_decks_last_20: PlayerState["unique_decks_last_20"];
    deck_stability_score: PlayerState["deck_stability_score"];
  }
> = {
  name: "get_deck_stats",
  schema: {
    name: "get_deck_stats",
    description:
      "Return deck-level performance: the player's best-performing deck sample, worst-performing deck sample, number of unique decks in the last 20 battles, and deck stability score (1.0 = one deck, lower = more switching). Use for questions like 'which of my decks is winning more?' or 'am I deck-switching too much?'. Takes no arguments.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  input: emptyInput,
  async run(context) {
    const [rawPlayer, battles] = await Promise.all([
      fetchRelayPlayer<{ tag?: string; trophies?: number }>(
        context.env,
        context.playerTag,
        context.requestId,
      ),
      loadNormalizedBattles(context),
    ]);
    const state = buildPlayerState(rawPlayer, battles);
    return {
      best_deck: state.best_deck,
      worst_deck: state.worst_deck,
      unique_decks_last_20: state.unique_decks_last_20,
      deck_stability_score: state.deck_stability_score,
    };
  },
};

// ---------------------------------------------------------------------------
// Tool: get_matchup_breakdown
// ---------------------------------------------------------------------------

const getMatchupBreakdown: ToolDefinition<
  z.infer<typeof matchupBreakdownInput>,
  {
    worst_matchups: PlayerState["worst_matchups"];
    best_matchups: PlayerState["best_matchups"];
    filtered: PlayerState["worst_matchups"];
  }
> = {
  name: "get_matchup_breakdown",
  schema: {
    name: "get_matchup_breakdown",
    description:
      "Return the player's worst and best matchups by archetype. Use for 'why do I lose to X.Bow?' or 'what am I strong against?'. Optionally filter the combined list by archetype substring or minimum sample size. Returns three arrays: worst_matchups and best_matchups are always the top-5 each by win rate; filtered is the union narrowed by the arguments.",
    input_schema: {
      type: "object",
      properties: {
        archetype_contains: {
          type: "string",
          description:
            "Case-insensitive substring match against matchup archetype name (e.g. 'xbow', 'hog', 'golem').",
        },
        min_games: {
          type: "integer",
          minimum: 1,
          maximum: 100,
          description:
            "Exclude matchups with fewer than this many games played (default 1).",
        },
      },
      additionalProperties: false,
    },
  },
  input: matchupBreakdownInput,
  async run(context, input) {
    const [rawPlayer, battles] = await Promise.all([
      fetchRelayPlayer<{ tag?: string; trophies?: number }>(
        context.env,
        context.playerTag,
        context.requestId,
      ),
      loadNormalizedBattles(context),
    ]);
    const state = buildPlayerState(rawPlayer, battles);
    const needle = input.archetype_contains?.toLowerCase();
    const minGames = input.min_games ?? 1;
    const all = [...state.worst_matchups, ...state.best_matchups];
    const filtered = all.filter((matchup) => {
      if (matchup.games < minGames) return false;
      if (needle && !matchup.archetype.toLowerCase().includes(needle)) {
        return false;
      }
      return true;
    });
    return {
      worst_matchups: state.worst_matchups,
      best_matchups: state.best_matchups,
      filtered,
    };
  },
};

// ---------------------------------------------------------------------------
// Tool: get_clan_info
// ---------------------------------------------------------------------------
//
// Added as a fifth tool because the original design document listed five
// categories (profile, battles, analytics, deck stats, matchups) but the
// "matchups" category already shares data with analytics. Clan context
// is a genuinely distinct source and lets the agent answer questions
// about the player's clan, war participation, and donation behavior.

interface ClanInfoOutput {
  tag?: string;
  name?: string;
  description?: string;
  type?: string;
  members?: number;
  clan_war_trophies?: number;
  required_trophies?: number;
  donations_per_week?: number;
}

const getClanInfo: ToolDefinition<
  z.infer<typeof emptyInput>,
  ClanInfoOutput
> = {
  name: "get_clan_info",
  schema: {
    name: "get_clan_info",
    description:
      "Return information about the player's current clan, if any: name, description, member count, war trophies, required trophies, donations per week. Use for 'should I switch clans?' or context about the player's social setup. Returns an empty object if the player is not in a clan.",
    input_schema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
  },
  input: emptyInput,
  async run(context) {
    const profile = await fetchRelayPlayer<Record<string, unknown>>(
      context.env,
      context.playerTag,
      context.requestId,
    );
    const clanStub = profile.clan as { tag?: string } | undefined;
    if (!clanStub?.tag) {
      return {};
    }
    const clan = await fetchRelayClan<Record<string, unknown>>(
      context.env,
      clanStub.tag,
      context.requestId,
    );
    return {
      tag: clan.tag as string | undefined,
      name: clan.name as string | undefined,
      description: clan.description as string | undefined,
      type: clan.type as string | undefined,
      members: clan.members as number | undefined,
      clan_war_trophies: clan.clanWarTrophies as number | undefined,
      required_trophies: clan.requiredTrophies as number | undefined,
      donations_per_week: clan.donationsPerWeek as number | undefined,
    };
  },
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

const registry = {
  get_player_profile: getPlayerProfile,
  get_recent_battles: getRecentBattles,
  get_player_analytics: getPlayerAnalytics,
  get_deck_stats: getDeckStats,
  get_matchup_breakdown: getMatchupBreakdown,
  get_clan_info: getClanInfo,
} as const;

export type ToolName = keyof typeof registry;

/** The full set of Anthropic tool schemas, ready to pass as `tools:`. */
export const toolSchemas: AnthropicToolSchema[] = Object.values(registry).map(
  (tool) => tool.schema,
);

/**
 * Validate a tool input payload against its Zod schema.
 *
 * Throws UnknownToolError for a name not in the registry.
 * Throws ToolInputError with the Zod issues when validation fails.
 * Returns the parsed (narrowed) input on success.
 */
export function validateToolInput(
  toolName: string,
  rawInput: unknown,
): { name: ToolName; input: unknown } {
  if (!(toolName in registry)) {
    throw new UnknownToolError(toolName);
  }
  const tool = registry[toolName as ToolName];
  const result = tool.input.safeParse(rawInput);
  if (!result.success) {
    throw new ToolInputError(toolName, result.error.issues);
  }
  return { name: toolName as ToolName, input: result.data };
}

/**
 * Dispatch a tool call. Assumes the input has already been validated
 * via validateToolInput (separation keeps error handling clean in the
 * orchestrator: validation errors get reported to Claude as tool_result
 * failures, runtime errors bubble up to the route's error handler).
 */
export async function dispatchTool(
  context: ToolContext,
  toolName: string,
  input: unknown,
): Promise<unknown> {
  // Defensive name check: the orchestrator may call dispatchTool with a
  // name it read off a Claude tool_use block without pre-validating.
  // Surface UnknownToolError rather than crashing on a registry miss.
  if (!(toolName in registry)) {
    throw new UnknownToolError(toolName);
  }
  const tool = registry[toolName as ToolName];
  // Zod re-check — dispatchTool accepts pre-validated input from
  // validateToolInput, but a programming error upstream should surface
  // as a ToolInputError, not an obscure runtime failure.
  const parsed = tool.input.safeParse(input);
  if (!parsed.success) {
    throw new ToolInputError(toolName, parsed.error.issues);
  }
  return tool.run(context, parsed.data as never);
}

/** Accessor for the registry, mainly for tests. */
export function getToolDefinition(name: ToolName): ToolDefinition<
  unknown,
  unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return registry[name] as unknown as ToolDefinition<any, any>;
}
