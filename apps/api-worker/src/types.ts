export interface Env {
  ALLOWED_ORIGINS?: string;
  RELAY_BASE_URL?: string;
  RELAY_SHARED_SECRET?: string;
  AI?: Ai;
  AI_EVENTS?: AnalyticsEngineDataset;
  AI_GATEWAY_ID?: string;
  WORKERS_AI_MODEL?: string;
  ANTHROPIC_API_KEY?: string;
  ANTHROPIC_MODEL?: string;
  LEMONSQUEEZY_API_KEY?: string;
  LEMONSQUEEZY_STORE_ID?: string;
  LEMONSQUEEZY_VARIANT_ID?: string;
  LEMONSQUEEZY_WEBHOOK_SECRET?: string;
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  APP_BASE_URL?: string;
  STRUCTURED_LOGS_ENABLED?: string;
  // --- Custom/self-hosted model lane (Phase 1: operator-only) ---
  /** Base URL for the self-hosted OpenAI-compatible endpoint (e.g. https://garage-model.example.com/v1). */
  CUSTOM_MODEL_URL?: string;
  /** Bearer token for the self-hosted endpoint (OpenAI-style Authorization header). */
  CUSTOM_MODEL_KEY?: string;
  /** Shared secret sent as X-Custom-Model-Auth so origin can reject unauthorized traffic even if URL leaks. */
  CUSTOM_MODEL_SHARED_SECRET?: string;
  /** Model name passed in the chat/completions body (e.g. "coachroyale-qwen2.5-14b-ft-v1"). */
  CUSTOM_MODEL_NAME?: string;
  /** Comma-separated Supabase user IDs that route to the custom lane. Phase 1 gate. */
  OPERATOR_USER_IDS?: string;
  /**
   * Cloudflare Workers Rate Limiting binding scoped to the unauthenticated
   * relay routes. Optional in the type so test envs and local dev can omit
   * it; the helper that calls it no-ops when undefined. Bound in
   * wrangler.toml as RELAY_LIMITER (30 req / 60s per CF-Connecting-IP).
   */
  RELAY_LIMITER?: {
    limit: (input: { key: string }) => Promise<{ success: boolean }>;
  };
}

export interface TrackedPlayerRecord {
  id: string;
  user_id: string;
  player_tag: string;
  player_name: string | null;
  is_primary: boolean;
  nickname: string | null;
  added_at: string;
  last_synced_at: string | null;
}

export interface AnalysisHistoryRecord {
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
    tracked_players: TrackedPlayerRecord[];
    player_snapshots: Record<string, unknown>[];
    battles: Record<string, unknown>[];
    favorite_decks: Record<string, unknown>[];
    deck_stats: Record<string, unknown>[];
    analysis_history: AnalysisHistoryRecord[];
    free_ai_usage: Record<string, unknown>[];
  };
  notes: {
    browser_only_data_excluded: string[];
  };
}

export interface Card {
  name?: string;
  id?: number;
  level?: number;
  maxLevel?: number;
  count?: number;
  iconUrls?: {
    medium?: string;
    evolutionMedium?: string;
  };
}

export interface BattleParticipant {
  tag?: string;
  name?: string;
  crowns?: number;
  trophyChange?: number;
  startingTrophies?: number;
  cards?: Card[];
}

export interface RawBattle {
  type?: string;
  battleTime?: string;
  arena?: {
    id?: number;
    name?: string;
  };
  gameMode?: {
    id?: number;
    name?: string;
  } | null;
  isLadderTournament?: boolean;
  deckSelection?: string;
  team?: BattleParticipant[];
  opponent?: BattleParticipant[];
}

export interface NormalizedBattle {
  id: string;
  playerTag: string;
  playerName: string;
  opponentTag: string;
  opponentName: string;
  playerDeck: string[];
  opponentDeck: string[];
  result: "victory" | "defeat" | "draw";
  trophyChange: number;
  playerTrophies: number;
  opponentTrophies: number;
  playedAt: string;
  gameMode: string;
}

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
  trend_direction: "improving" | "plateau" | "declining";
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
  time_slot_data: Record<
    string,
    { games: number; win_rate: number; confidence: string }
  >;
  win_rate_variance: number;
  result_volatility: string;
}
