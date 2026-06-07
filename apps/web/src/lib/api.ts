import { supabase } from './supabase';
import { z } from 'zod';
import { normalizeModelConfig } from './modelConfig';

const isLocalDev =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

const rawApiBase = import.meta.env.VITE_API_BASE_URL?.trim();
const API_BASE =
  rawApiBase && rawApiBase.length > 0
    ? rawApiBase.replace(/\/$/, '')
    : isLocalDev
      ? 'http://localhost:8787/api'
      : 'https://relay.coach-royale.com/api';

const COACH_QUESTION_TIMEOUT_MS = 5 * 60 * 1000;

function buildApiUrl(path: string): string {
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`;
}

function normalizeTag(tag: string): string {
  const normalizedTag = tag.trim().toUpperCase();
  return normalizedTag.startsWith('#') ? normalizedTag : `#${normalizedTag}`;
}

function encodeTag(tag: string): string {
  return encodeURIComponent(normalizeTag(tag));
}

async function getAccessToken(): Promise<string | null> {
  const {
    data: { session },
  } = await supabase.auth.getSession();
  return session?.access_token ?? null;
}

async function buildAuthenticatedInit(init?: RequestInit): Promise<RequestInit | undefined> {
  const accessToken = await getAccessToken();
  if (!accessToken) {
    return init;
  }

  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${accessToken}`);

  return {
    ...init,
    headers,
  };
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const authenticatedInit = await buildAuthenticatedInit(init);
  return authenticatedInit ? fetch(buildApiUrl(path), authenticatedInit) : fetch(buildApiUrl(path));
}

function describeSchemaError(error: z.ZodError): string {
  const issue = error.issues[0];
  if (!issue) {
    return 'Unknown response validation error';
  }

  const path = issue.path.length > 0 ? issue.path.join('.') : 'response';
  return `${path}: ${issue.message}`;
}

function parseJsonPayload<T>(payload: unknown, schema: z.ZodType<T>, fallbackMessage: string): T {
  try {
    return schema.parse(payload);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new Error(
        `${fallbackMessage}: invalid response payload (${describeSchemaError(error)})`,
      );
    }
    throw error;
  }
}

/** Worker JSON errors: legacy `{ error: string }` or `{ error: { code, message }, request_id? }`. */
function extractHttpErrorMessage(payload: unknown): string | null {
  if (typeof payload !== 'object' || payload === null) {
    return null;
  }
  const rec = payload as Record<string, unknown>;
  const err = rec.error;
  if (typeof err === 'string') {
    return err;
  }
  if (typeof err === 'object' && err !== null) {
    const obj = err as Record<string, unknown>;
    if (typeof obj.message === 'string') {
      return obj.message;
    }
  }
  return null;
}

async function readJsonResponse<T>(
  response: Response,
  fallbackMessage: string,
  schema?: z.ZodType<T>,
): Promise<T> {
  const responseText = await response.text();
  let payload: unknown = {};

  if (responseText) {
    try {
      payload = JSON.parse(responseText) as unknown;
    } catch {
      if (!response.ok) {
        throw new Error(`${fallbackMessage} (${response.status})`);
      }
      throw new Error(`${fallbackMessage}: invalid JSON response`);
    }
  }

  if (!response.ok) {
    const extracted = extractHttpErrorMessage(payload);
    if (extracted) {
      throw new Error(extracted);
    }
    throw new Error(`${fallbackMessage} (${response.status})`);
  }

  return schema ? parseJsonPayload(payload, schema, fallbackMessage) : (payload as T);
}

async function requestJson<T>(
  path: string,
  fallbackMessage: string,
  init?: RequestInit,
  schema?: z.ZodType<T>,
): Promise<T> {
  const response = await request(path, init);
  return readJsonResponse<T>(response, fallbackMessage, schema);
}

export interface PlayerData {
  name: string;
  tag: string;
  expLevel: number;
  trophies: number;
  bestTrophies: number;
  wins: number;
  losses: number;
  battleCount: number;
  threeCrownWins: number;
  challengeCardsWon: number;
  challengeMaxWins: number;
  tournamentCardsWon: number;
  tournamentBattleCount: number;
  role?: string;
  donations: number;
  donationsReceived: number;
  totalDonations: number;
  warDayWins: number;
  clanWarTrophies: number;
  clan?: { tag: string; name: string; badgeId: number };
  arena?: { id: number; name: string };
  currentDeck: Card[];
  cards: Card[];
  currentFavouriteCard?: Card;
  starPoints: number;
  expPoints: number;
}

export interface Card {
  name: string;
  id: number;
  level: number;
  maxLevel: number;
  count: number;
  iconUrls: { medium: string; evolutionMedium?: string };
  elixirCost?: number;
  rarity?: string;
}

export interface Battle {
  type: string;
  battleTime: string;
  isLadderTournament: boolean;
  arena: { id: number; name: string };
  gameMode: { id: number; name: string } | null;
  deckSelection: string;
  team: BattleParticipant[];
  opponent: BattleParticipant[];
}

export interface BattleParticipant {
  tag: string;
  name: string;
  startingTrophies: number;
  trophyChange?: number;
  crowns: number;
  kingTowerHitPoints: number;
  princessTowersHitPoints: number[];
  cards: Card[];
}

export interface ChestInfo {
  items: { index: number; name: string }[];
}

export interface AIResponse {
  success: boolean;
  result: { response: string };
  text?: string | null;
  upsell?: AiUpsell;
  player_state?: PlayerState;
}

export interface AiUpsell {
  reason: 'daily_limit' | 'pool_exhausted';
  cta: string;
  upgrade_url: string;
}

type AnalysisScope = 'quick' | 'deep';

export interface DeckStat {
  deck_hash: string;
  cards: string[];
  games: number;
  wins: number;
  win_rate: number;
  confidence: string;
}

export interface MatchupStat {
  archetype: string;
  games: number;
  wins: number;
  win_rate: number;
  confidence: string;
  trend: string;
}

export interface PlayerState {
  player_tag: string;
  trophies: number;
  total_battles: number;
  battles_analyzed: number;
  win_rate_last_10: number | null;
  win_rate_last_20: number | null;
  win_rate_last_50: number | null;
  win_rate_overall: number;
  trend_direction: 'improving' | 'plateau' | 'declining';
  trend_strength: number;
  trend_confidence: string;
  trophy_delta_7d: number;
  best_deck: DeckStat | null;
  worst_deck: DeckStat | null;
  deck_stability_score: number;
  unique_decks_last_20: number;
  worst_matchups: MatchupStat[];
  best_matchups: MatchupStat[];
  tilt_win_rate: number | null;
  baseline_win_rate: number;
  tilt_impact: number | null;
  tilt_confidence: string;
  best_time_slot: string | null;
  worst_time_slot: string | null;
  time_slot_data: Record<string, { games: number; win_rate: number; confidence: string }>;
  win_rate_variance: number;
  result_volatility: string;
}

export interface WeeklyPlan {
  coaching_summary: string;
  performance_verdict: string;
  confidence: string;
  top_priority: {
    title: string;
    description: string;
    evidence: string;
    expected_impact: string;
  };
  weekly_goals: { goal: string; metric: string; how: string }[];
  drills: { name: string; description: string; sessions_per_day: number }[];
  deck_recommendation: {
    verdict: string;
    reasoning: string;
    suggested_swap: string | null;
  };
  matchup_alerts: { archetype: string; win_rate: number; tip: string }[];
  tilt_note: string | null;
  confidence_builders: string[];
}

export interface CoachingReport {
  matchup_summary: string;
  player_mistakes: string;
  player_corrections: string;
  opponent_mistakes: string;
  how_to_capitalize: string;
  key_tip: string;
  performance_score: number;
  elixir_efficiency_rating: string;
}

export interface MatchupPreview {
  player_win_pct: number;
  win_reasoning: string;
  matchup_label: string;
  single_elixir: string;
  double_elixir: string;
  triple_elixir: string;
}

export interface TrackedPlayer {
  id: string;
  user_id: string;
  player_tag: string;
  player_name: string | null;
  is_primary: boolean;
  nickname: string | null;
  added_at: string;
  last_synced_at: string | null;
}

export interface AnalysisRecord {
  id: string;
  user_id: string;
  player_tag: string;
  analysis_type: string;
  prompt: string | null;
  result: string;
  model: string | null;
  created_at: string;
}

export interface PrivacySettings {
  data_retention_days: 30 | 90 | 365;
  privacy_policy_version: string | null;
  privacy_policy_accepted_at: string | null;
  byok_local_storage_notice_accepted_at: string | null;
}

export interface PrivacyExportPayload {
  exported_at: string;
  user: {
    id: string;
    email?: string;
  };
  privacy_settings: PrivacySettings;
  data: {
    profile: Record<string, unknown> | null;
    tracked_players: TrackedPlayer[];
    player_snapshots: Record<string, unknown>[];
    battles: Record<string, unknown>[];
    favorite_decks: Record<string, unknown>[];
    deck_stats: Record<string, unknown>[];
    analysis_history: AnalysisRecord[];
    free_ai_usage: Record<string, unknown>[];
  };
  notes: {
    browser_only_data_excluded: string[];
  };
}

const cardSchema = z.object({
  name: z.string(),
  id: z.number(),
  // level/count are absent on currentFavouriteCard (only deck/collection cards
  // carry them). Default to 0 so the field stays a number for all consumers.
  level: z.number().default(0),
  maxLevel: z.number(),
  count: z.number().default(0),
  iconUrls: z.object({
    medium: z.string(),
    evolutionMedium: z.string().optional(),
  }),
  elixirCost: z.number().optional(),
  rarity: z.string().optional(),
});

const battleParticipantSchema = z.object({
  tag: z.string(),
  name: z.string(),
  startingTrophies: z.number(),
  trophyChange: z.number().optional(),
  crowns: z.number(),
  kingTowerHitPoints: z
    .number()
    .nullish()
    .transform((value) => value ?? 0),
  // Supercell sends null (not just omits) when towers are destroyed; `.default`
  // only fills undefined, so coerce null/undefined → [] explicitly.
  princessTowersHitPoints: z
    .array(z.number())
    .nullish()
    .transform((value) => value ?? []),
  cards: z.array(cardSchema),
});

const battleSchema = z.object({
  type: z.string(),
  battleTime: z.string(),
  isLadderTournament: z.boolean().default(false),
  arena: z.object({
    id: z.number(),
    name: z.string(),
  }),
  gameMode: z
    .object({
      id: z.number(),
      name: z.string(),
    })
    .nullable(),
  deckSelection: z.string().default(''),
  team: z.array(battleParticipantSchema),
  opponent: z.array(battleParticipantSchema),
});

const playerDataSchema = z.object({
  name: z.string(),
  tag: z.string(),
  expLevel: z.number(),
  trophies: z.number(),
  bestTrophies: z.number(),
  wins: z.number(),
  losses: z.number(),
  battleCount: z.number(),
  threeCrownWins: z.number(),
  challengeCardsWon: z.number(),
  challengeMaxWins: z.number(),
  tournamentCardsWon: z.number(),
  tournamentBattleCount: z.number(),
  role: z.string().optional(),
  donations: z.number(),
  donationsReceived: z.number(),
  totalDonations: z.number(),
  warDayWins: z.number(),
  // Supercell deprecated clanWarTrophies (Clan Wars 1 → 2); it is no longer
  // present on the player payload. Tolerate absent/null and default to 0 so the
  // rest of the schema (and downstream `number` consumers) keep working.
  clanWarTrophies: z
    .number()
    .nullish()
    .transform((value) => value ?? 0),
  clan: z
    .object({
      tag: z.string(),
      name: z.string(),
      badgeId: z.number(),
    })
    .optional(),
  arena: z
    .object({
      id: z.number(),
      name: z.string(),
    })
    .optional(),
  currentDeck: z.array(cardSchema),
  cards: z.array(cardSchema),
  currentFavouriteCard: cardSchema.optional(),
  starPoints: z.number(),
  expPoints: z.number(),
});

const aiUpsellSchema = z.object({
  reason: z.enum(['daily_limit', 'pool_exhausted']),
  cta: z.string(),
  upgrade_url: z.string(),
});

const deckStatSchema = z.object({
  deck_hash: z.string(),
  cards: z.array(z.string()),
  games: z.number(),
  wins: z.number(),
  win_rate: z.number(),
  confidence: z.string(),
});

const matchupStatSchema = z.object({
  archetype: z.string(),
  games: z.number(),
  wins: z.number(),
  win_rate: z.number(),
  confidence: z.string(),
  trend: z.string(),
});

const playerStateSchema = z.object({
  player_tag: z.string(),
  trophies: z.number(),
  total_battles: z.number(),
  battles_analyzed: z.number(),
  win_rate_last_10: z.number().nullable(),
  win_rate_last_20: z.number().nullable(),
  win_rate_last_50: z.number().nullable(),
  win_rate_overall: z.number(),
  trend_direction: z.enum(['improving', 'plateau', 'declining']),
  trend_strength: z.number(),
  trend_confidence: z.string(),
  trophy_delta_7d: z.number(),
  best_deck: deckStatSchema.nullable(),
  worst_deck: deckStatSchema.nullable(),
  deck_stability_score: z.number(),
  unique_decks_last_20: z.number(),
  worst_matchups: z.array(matchupStatSchema),
  best_matchups: z.array(matchupStatSchema),
  tilt_win_rate: z.number().nullable(),
  baseline_win_rate: z.number(),
  tilt_impact: z.number().nullable(),
  tilt_confidence: z.string(),
  best_time_slot: z.string().nullable(),
  worst_time_slot: z.string().nullable(),
  time_slot_data: z.record(
    z.string(),
    z.object({
      games: z.number(),
      win_rate: z.number(),
      confidence: z.string(),
    }),
  ),
  win_rate_variance: z.number(),
  result_volatility: z.string(),
});

const aiResponseSchema = z.object({
  success: z.boolean(),
  result: z.object({
    response: z.string(),
  }),
  text: z.string().nullable().optional(),
  upsell: aiUpsellSchema.optional(),
  player_state: playerStateSchema.optional(),
});

const weeklyPlanSchema = z.object({
  coaching_summary: z.string(),
  performance_verdict: z.string(),
  confidence: z.string(),
  top_priority: z.object({
    title: z.string(),
    description: z.string(),
    evidence: z.string(),
    expected_impact: z.string(),
  }),
  weekly_goals: z.array(
    z.object({
      goal: z.string(),
      metric: z.string(),
      how: z.string(),
    }),
  ),
  drills: z.array(
    z.object({
      name: z.string(),
      description: z.string(),
      sessions_per_day: z.number(),
    }),
  ),
  deck_recommendation: z.object({
    verdict: z.string(),
    reasoning: z.string(),
    suggested_swap: z.string().nullable(),
  }),
  matchup_alerts: z.array(
    z.object({
      archetype: z.string(),
      win_rate: z.number(),
      tip: z.string(),
    }),
  ),
  tilt_note: z.string().nullable(),
  confidence_builders: z.array(z.string()),
});

const trackedPlayerSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  player_tag: z.string(),
  player_name: z.string().nullable(),
  is_primary: z.boolean(),
  nickname: z.string().nullable(),
  added_at: z.string(),
  last_synced_at: z.string().nullable(),
});

const analysisRecordSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  player_tag: z.string(),
  analysis_type: z.string(),
  prompt: z.string().nullable(),
  result: z.string(),
  model: z.string().nullable(),
  created_at: z.string(),
});

const privacySettingsSchema = z.object({
  data_retention_days: z.union([z.literal(30), z.literal(90), z.literal(365)]),
  privacy_policy_version: z.string().nullable(),
  privacy_policy_accepted_at: z.string().nullable(),
  byok_local_storage_notice_accepted_at: z.string().nullable(),
});

const genericRecordSchema = z.record(z.string(), z.unknown());

const privacyExportPayloadSchema = z.object({
  exported_at: z.string(),
  user: z.object({
    id: z.string(),
    email: z.string().optional(),
  }),
  privacy_settings: privacySettingsSchema,
  data: z.object({
    profile: genericRecordSchema.nullable(),
    tracked_players: z.array(trackedPlayerSchema),
    player_snapshots: z.array(genericRecordSchema),
    battles: z.array(genericRecordSchema),
    favorite_decks: z.array(genericRecordSchema),
    deck_stats: z.array(genericRecordSchema),
    analysis_history: z.array(analysisRecordSchema),
    free_ai_usage: z.array(genericRecordSchema),
  }),
  notes: z.object({
    browser_only_data_excluded: z.array(z.string()),
  }),
});

const analysisResponseSchema = z.object({
  analysis: z.string(),
  text: z.string().nullable().optional(),
  upsell: aiUpsellSchema.optional(),
  player_state: playerStateSchema.optional(),
});

const playerAnalyticsResponseSchema = z.object({
  player_state: playerStateSchema,
});

const weeklyPlanResponseSchema = z.object({
  plan: weeklyPlanSchema,
  from_cache: z.boolean(),
});

const coachAnswerSchema = z.object({
  answer: z.string(),
});

const syncPlayerResponseSchema = z.object({
  battles_synced: z.number(),
  battles_added: z.number(),
  player: z.unknown(),
});

const checkoutResponseSchema = z.object({
  checkout_url: z.string(),
});

const subscriptionStatusSchema = z.object({
  user_id: z.string(),
  tier: z.enum(['free', 'pro']),
  limits: z.object({
    quick_analysis: z.number(),
    deep_analysis: z.number(),
  }),
  usage_today: z.object({
    quick_analysis: z.number(),
    deep_analysis: z.number(),
  }),
});

const customModelResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().min(1),
        }),
      }),
    )
    .min(1),
});

export async function fetchPlayer(tag: string, signal?: AbortSignal): Promise<PlayerData> {
  return requestJson<PlayerData>(
    `/player/${encodeTag(tag)}`,
    'Player not found',
    signal ? { signal } : undefined,
    playerDataSchema,
  );
}

export async function fetchBattleLog(tag: string, signal?: AbortSignal): Promise<Battle[]> {
  return requestJson<Battle[]>(
    `/player/${encodeTag(tag)}/battles`,
    'Failed to fetch battles',
    signal ? { signal } : undefined,
    z.array(battleSchema),
  );
}

export async function fetchChests(tag: string): Promise<ChestInfo> {
  return requestJson<ChestInfo>(`/player/${encodeTag(tag)}/chests`, 'Failed to fetch chests');
}

export async function fetchDeepAnalysis(tag: string): Promise<{
  analysis: string;
  text?: string | null;
  upsell?: AiUpsell;
  player_state?: PlayerState;
}> {
  return requestJson<{
    analysis: string;
    text?: string | null;
    upsell?: AiUpsell;
    player_state?: PlayerState;
  }>(
    '/analysis',
    'Analysis failed',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tag: normalizeTag(tag) }),
    },
    analysisResponseSchema,
  );
}

export async function fetchExperimentalDeepAnalysis(
  playerData: Record<string, unknown>,
  battles: Record<string, unknown>[],
): Promise<AIResponse> {
  const prompt = `Provide a detailed strategic coaching analysis for this Clash Royale player.
Include: performance assessment, deck analysis, matchup insights, tilt assessment, and one priority action item.
Be specific with card names and trophy ranges.`;

  return fetchQuickAnalysis(
    prompt,
    { ...playerData, recent_battles: battles.slice(0, 10) },
    'battle_summary',
    {
      analysisScope: 'deep',
      playerTag: typeof playerData.tag === 'string' ? playerData.tag : undefined,
    },
  );
}

export async function fetchQuickAnalysis(
  prompt: string,
  playerData: Record<string, unknown>,
  type: 'quick_stats' | 'deck_tips' | 'battle_summary',
  options: {
    analysisScope?: AnalysisScope;
    playerTag?: string;
  } = {},
): Promise<AIResponse> {
  return requestJson<AIResponse>(
    '/ai/respond',
    'AI analysis failed',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt,
        playerData,
        type,
        player_tag: options.playerTag ? normalizeTag(options.playerTag) : undefined,
        analysis_scope: options.analysisScope ?? 'quick',
      }),
    },
    aiResponseSchema,
  );
}

export async function fetchPlayerAnalytics(tag: string): Promise<{ player_state: PlayerState }> {
  return requestJson<{ player_state: PlayerState }>(
    `/player/${encodeTag(tag)}/analytics`,
    'Analytics failed',
    undefined,
    playerAnalyticsResponseSchema,
  );
}

export async function fetchWeeklyPlan(
  tag: string,
  forceRegenerate = false,
): Promise<{ plan: WeeklyPlan; from_cache: boolean }> {
  return requestJson<{ plan: WeeklyPlan; from_cache: boolean }>(
    `/coach/weekly-plan/${encodeTag(tag)}`,
    'Weekly plan failed',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ force_regenerate: forceRegenerate }),
    },
    weeklyPlanResponseSchema,
  );
}

export async function askCoachQuestion(tag: string, question: string): Promise<{ answer: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COACH_QUESTION_TIMEOUT_MS);

  try {
    const response = await request(`/coach/question/${encodeTag(tag)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question }),
      signal: controller.signal,
    });

    return readJsonResponse<{ answer: string }>(
      response,
      'Coach question failed',
      coachAnswerSchema,
    );
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Streaming agent chat (AG5). Consumes POST /api/coach/agent/:tag SSE.
// ---------------------------------------------------------------------------

/**
 * Event frames emitted by the Worker's agent loop. Mirrors the shape of
 * the server-side AgentEvent (apps/api-worker/src/lib/agent.ts) plus the
 * `thread` opening frame that the route sends before the loop starts.
 *
 * We duplicate the type here rather than share a package because the
 * worker and web app are separate npm projects; a drift would be caught
 * by the test that round-trips a known SSE frame.
 */
export type AgentStreamEvent =
  | {
      type: 'thread';
      thread_id: string;
      player_tag: string;
    }
  | {
      type: 'assistant_text';
      text: string;
    }
  | {
      type: 'tool_call';
      toolUseId: string;
      name: string;
      input: unknown;
    }
  | {
      type: 'tool_result';
      toolUseId: string;
      name: string;
      isError: boolean;
      content: string;
      latencyMs: number;
    }
  | {
      type: 'final';
      text: string;
      turns: number;
      usage: { input_tokens: number; output_tokens: number };
    }
  | {
      type: 'error';
      reason: 'max_turns_exceeded' | 'aborted' | 'anthropic_unavailable' | 'anthropic_error';
      detail?: string;
    };

/**
 * Parses a single SSE block (separated by `\n\n`) into an (event, data)
 * pair. Tolerates blocks missing an explicit `event:` line by defaulting
 * to "message". Returns null on an unparseable data payload.
 */
function parseSseFrame(block: string): { event: string; data: unknown } | null {
  const trimmed = block.trim();
  if (!trimmed) return null;
  let event = 'message';
  const dataLines: string[] = [];
  for (const line of trimmed.split('\n')) {
    if (line.startsWith('event: ')) event = line.slice(7).trim();
    else if (line.startsWith('data: ')) dataLines.push(line.slice(6));
  }
  if (dataLines.length === 0) return null;
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return null;
  }
}

export interface StreamCoachAgentOptions {
  /** Called once for every decoded SSE frame. */
  onEvent: (event: AgentStreamEvent) => void;
  /** Resume an existing thread; omit to start a new one. */
  threadId?: string;
  /** Abort the request and the underlying Anthropic call. */
  signal?: AbortSignal;
}

/**
 * Streams an agentic coach turn. Resolves when the stream closes cleanly.
 *
 * The Worker emits a first `thread` frame before any agent events so the
 * caller can persist the `thread_id` for resume. Consumers should treat
 * the resolved return value as advisory — authoritative state is whatever
 * was handed to `onEvent` along the way.
 */
export async function streamCoachAgent(
  tag: string,
  question: string,
  options: StreamCoachAgentOptions,
): Promise<{ thread_id: string | null }> {
  const response = await request(`/coach/agent/${encodeTag(tag)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
    },
    body: JSON.stringify({
      question,
      thread_id: options.threadId,
    }),
    signal: options.signal,
  });

  if (!response.ok) {
    const message = await extractHttpErrorFromResponse(response);
    throw new Error(message ?? `Coach agent request failed (${response.status})`);
  }

  if (!response.body) {
    throw new Error('Coach agent stream has no body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let threadId: string | null = null;

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Split on the SSE frame delimiter. The trailing partial block
      // stays in the buffer for the next read.
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const raw = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const frame = parseSseFrame(raw);
        if (frame) {
          const event = frame.data as AgentStreamEvent;
          if (event && typeof event === 'object' && 'type' in event) {
            if (event.type === 'thread') {
              threadId = event.thread_id;
            }
            options.onEvent(event);
          }
        }
        boundary = buffer.indexOf('\n\n');
      }
    }
    // Flush any remaining decoder state and a trailing frame.
    buffer += decoder.decode();
    if (buffer.trim()) {
      const frame = parseSseFrame(buffer);
      if (frame) {
        const event = frame.data as AgentStreamEvent;
        if (event && typeof event === 'object' && 'type' in event) {
          options.onEvent(event);
        }
      }
    }
  } finally {
    // Release the reader so the server can close its end cleanly on abort.
    try {
      reader.releaseLock();
    } catch {
      /* noop */
    }
  }

  return { thread_id: threadId };
}

// ---------------------------------------------------------------------------
// Coach agent Pro beta opt-in (AG7).
// ---------------------------------------------------------------------------

export interface CoachAgentBetaState {
  opted_in: boolean;
  /** True for Pro users, false for free. Free users see the toggle disabled. */
  eligible: boolean;
}

const coachAgentBetaStateSchema = z.object({
  opted_in: z.boolean(),
  eligible: z.boolean(),
});

/**
 * Reads the authenticated user's current beta opt-in state. Returns null
 * when the user is anonymous (401) rather than throwing — the UI degrades
 * gracefully (hides the toggle) instead of showing an error.
 */
export async function fetchCoachAgentBetaState(): Promise<CoachAgentBetaState | null> {
  const response = await request('/coach/agent-beta', { method: 'GET' });
  if (response.status === 401) return null;
  return readJsonResponse<CoachAgentBetaState>(
    response,
    'Failed to fetch agent beta state',
    coachAgentBetaStateSchema,
  );
}

/**
 * Writes the authenticated user's opt-in state. Pro-only (403 for free
 * users); the UI should refuse to call this when state.eligible=false.
 */
export async function setCoachAgentBetaOptIn(optedIn: boolean): Promise<CoachAgentBetaState> {
  const response = await request('/coach/agent-beta', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ opted_in: optedIn }),
  });
  // The endpoint returns just {opted_in}; synthesize eligible=true since
  // only Pro users can successfully reach here.
  const payload = await readJsonResponse<{ opted_in: boolean }>(
    response,
    'Failed to update agent beta state',
    z.object({ opted_in: z.boolean() }),
  );
  return { opted_in: payload.opted_in, eligible: true };
}

/** Best-effort error extraction from a non-OK Response before reading body. */
async function extractHttpErrorFromResponse(response: Response): Promise<string | null> {
  try {
    const text = await response.text();
    if (!text) return null;
    try {
      const payload = JSON.parse(text) as unknown;
      return extractHttpErrorMessage(payload);
    } catch {
      return text.slice(0, 200);
    }
  } catch {
    return null;
  }
}

const CUSTOM_MODEL_SYSTEM_PROMPT =
  'You are ClashCoach AI, an elite Clash Royale coach. ' +
  'Analyze the provided player data and recent battles. ' +
  'Give a concise coaching report covering: win-rate trend, ' +
  'deck strengths and weaknesses, matchup problems, tilt risk, ' +
  'and one clear priority action item. Be specific with card names.';

export async function fetchCustomModelAnalysis(
  config: { baseUrl: string; apiKey: string; model: string },
  playerData: Record<string, unknown>,
  battles: Record<string, unknown>[],
  signal?: AbortSignal,
): Promise<string> {
  const normalizedConfig = normalizeModelConfig(config);
  const userPrompt =
    `Analyze this Clash Royale player and provide a coaching report.\n\n` +
    `PLAYER DATA:\n${JSON.stringify(playerData, null, 2)}\n\n` +
    `RECENT BATTLES (last ${Math.min(battles.length, 20)}):\n` +
    `${JSON.stringify(battles.slice(0, 20), null, 2)}`;

  const url = `${normalizedConfig.baseUrl}/chat/completions`;
  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };
  if (normalizedConfig.apiKey) {
    headers.Authorization = `Bearer ${normalizedConfig.apiKey}`;
  }

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: normalizedConfig.model,
      messages: [
        { role: 'system', content: CUSTOM_MODEL_SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 1200,
      temperature: 0.7,
    }),
    signal,
  });

  if (!response.ok) {
    const responseText = await response.text().catch(() => '');
    let providerMessage = '';

    if (responseText) {
      try {
        const payload = JSON.parse(responseText) as unknown;
        if (
          typeof payload === 'object' &&
          payload !== null &&
          'error' in payload &&
          typeof payload.error === 'object' &&
          payload.error !== null &&
          'message' in payload.error &&
          typeof payload.error.message === 'string'
        ) {
          providerMessage = payload.error.message;
        } else {
          providerMessage = responseText;
        }
      } catch {
        providerMessage = responseText;
      }
    }

    const trimmedMessage =
      providerMessage.length > 240 ? `${providerMessage.slice(0, 240)}…` : providerMessage;
    throw new Error(
      `Model API error ${response.status}${trimmedMessage ? `: ${trimmedMessage}` : ''}`,
    );
  }

  const data = parseJsonPayload(
    (await response.json()) as unknown,
    customModelResponseSchema,
    'Custom model analysis failed',
  );
  return data.choices[0]?.message.content ?? 'No response from model.';
}

export async function syncPlayer(
  tag: string,
): Promise<{ battles_synced: number; battles_added: number; player: unknown }> {
  return requestJson<{ battles_synced: number; battles_added: number; player: unknown }>(
    `/player/${encodeTag(tag)}/sync`,
    'Sync failed',
    { method: 'POST' },
    syncPlayerResponseSchema,
  );
}

export async function createCheckout(
  userEmail: string,
  userId: string,
): Promise<{ checkout_url: string }> {
  return requestJson<{ checkout_url: string }>(
    '/payments/checkout',
    'Checkout failed',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_email: userEmail, user_id: userId }),
    },
    checkoutResponseSchema,
  );
}

export async function getSubscriptionStatus(userId: string): Promise<{
  user_id: string;
  tier: 'free' | 'pro';
  limits: { quick_analysis: number; deep_analysis: number };
  usage_today: { quick_analysis: number; deep_analysis: number };
}> {
  return requestJson<{
    user_id: string;
    tier: 'free' | 'pro';
    limits: { quick_analysis: number; deep_analysis: number };
    usage_today: { quick_analysis: number; deep_analysis: number };
  }>(
    `/payments/subscription/${userId}`,
    'Subscription check failed',
    undefined,
    subscriptionStatusSchema,
  );
}

export async function getTrackedPlayers(): Promise<TrackedPlayer[]> {
  return requestJson<TrackedPlayer[]>(
    '/tracked-players',
    'Failed to load tracked players',
    undefined,
    z.array(trackedPlayerSchema),
  );
}

export async function removeTrackedPlayer(id: string): Promise<void> {
  await requestJson<{ ok: true }>(`/tracked-players/${id}`, 'Failed to remove tracked player', {
    method: 'DELETE',
  });
}

export async function saveAnalysisHistory(record: {
  player_tag: string;
  analysis_type: string;
  prompt?: string;
  result: string;
  model?: string;
}): Promise<AnalysisRecord> {
  return requestJson<AnalysisRecord>(
    '/analysis-history',
    'Failed to save analysis',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(record),
    },
    analysisRecordSchema,
  );
}

export async function getAnalysisHistory(
  playerTag?: string,
  limit = 20,
): Promise<AnalysisRecord[]> {
  const query = new URLSearchParams();
  query.set('limit', String(limit));
  if (playerTag) {
    query.set('player_tag', normalizeTag(playerTag));
  }

  return requestJson<AnalysisRecord[]>(
    `/analysis-history?${query.toString()}`,
    'Failed to load analysis history',
    undefined,
    z.array(analysisRecordSchema),
  );
}

export async function getPrivacySettings(): Promise<PrivacySettings> {
  return requestJson<PrivacySettings>(
    '/gdpr/settings',
    'Failed to load privacy settings',
    undefined,
    privacySettingsSchema,
  );
}

export async function updatePrivacySettings(payload: {
  data_retention_days?: 30 | 90 | 365;
  privacy_policy_version?: string;
  acknowledge_privacy_policy?: boolean;
  acknowledge_byok_local_storage_notice?: boolean;
}): Promise<PrivacySettings> {
  return requestJson<PrivacySettings>(
    '/gdpr/settings',
    'Failed to save privacy settings',
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
    privacySettingsSchema,
  );
}

export async function exportUserData(): Promise<PrivacyExportPayload> {
  return requestJson<PrivacyExportPayload>(
    '/gdpr/export',
    'Failed to export user data',
    undefined,
    privacyExportPayloadSchema,
  );
}

export async function eraseUserData(): Promise<void> {
  await requestJson<{ ok: true }>('/gdpr/erase', 'Failed to erase user data', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmation: 'ERASE' }),
  });
}
