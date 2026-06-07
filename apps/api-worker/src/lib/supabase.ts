import { createClient } from "@supabase/supabase-js";

import type {
  AnalysisHistoryRecord,
  Env,
  PrivacyExportPayload,
  PrivacySettings,
  RawBattle,
  TrackedPlayerRecord,
} from "../types";
import { battleInsertRecord } from "./battles";
import { HttpError } from "./api-errors";
import { normalizeTag } from "./tags";

interface AuthenticatedUser {
  id: string;
  email?: string;
}

const FREE_ANALYSIS_LIMITS = {
  quick_analysis: 5,
  deep_analysis: 1,
} as const;

export const FREE_AI_DAILY_LIMIT = 30;

const PRO_ANALYSIS_LIMITS = {
  quick_analysis: 999,
  deep_analysis: 999,
} as const;

const QUICK_ANALYSIS_TYPES = [
  "quick_stats",
  "deck_tips",
  "battle_summary",
] as const;

type SubscriptionTier = "free" | "pro";

interface PrivacyProfileRow {
  data_retention_days?: number | null;
  privacy_policy_version?: string | null;
  privacy_policy_accepted_at?: string | null;
  byok_local_storage_notice_accepted_at?: string | null;
}

export interface ManagedAiAccess {
  user: {
    id: string;
    email?: string;
  } | null;
  tier: SubscriptionTier;
  limits: {
    quick_analysis: number;
    deep_analysis: number;
  };
  usage: {
    quick_analysis: number;
    deep_analysis: number;
  };
  free_ai?: {
    daily_limit: number;
    used_today: number;
  };
}

const VALID_RETENTION_DAYS = new Set([30, 90, 365]);

function sanitizeRetentionDays(
  value: number | null | undefined,
): 30 | 90 | 365 {
  if (value && VALID_RETENTION_DAYS.has(value)) {
    return value as 30 | 90 | 365;
  }
  return 365;
}

function privacySettingsFromRow(
  row: PrivacyProfileRow | null | undefined,
): PrivacySettings {
  return {
    data_retention_days: sanitizeRetentionDays(row?.data_retention_days),
    privacy_policy_version: row?.privacy_policy_version ?? null,
    privacy_policy_accepted_at: row?.privacy_policy_accepted_at ?? null,
    byok_local_storage_notice_accepted_at:
      row?.byok_local_storage_notice_accepted_at ?? null,
  };
}

async function readPrivacyProfileRow(
  admin: ReturnType<typeof requireAdminClient>,
  userId: string,
): Promise<PrivacyProfileRow | null> {
  const { data, error } = await admin
    .from("profiles")
    .select(
      "data_retention_days, privacy_policy_version, privacy_policy_accepted_at, byok_local_storage_notice_accepted_at",
    )
    .eq("id", userId)
    .single();

  if (error && error.code !== "PGRST116") {
    throw new Error(error.message);
  }

  return (data ?? null) as PrivacyProfileRow | null;
}

async function readPrivacySettings(
  admin: ReturnType<typeof requireAdminClient>,
  userId: string,
): Promise<PrivacySettings> {
  return privacySettingsFromRow(await readPrivacyProfileRow(admin, userId));
}

async function enforceUserRetention(
  admin: ReturnType<typeof requireAdminClient>,
  userId: string,
  retentionDays: 30 | 90 | 365,
): Promise<void> {
  const cutoff = new Date();
  cutoff.setUTCDate(cutoff.getUTCDate() - retentionDays);
  const cutoffIso = cutoff.toISOString();
  const cutoffDate = cutoffIso.slice(0, 10);

  await Promise.all([
    admin
      .from("player_snapshots")
      .delete()
      .eq("user_id", userId)
      .lt("snapshot_date", cutoffDate),
    admin
      .from("battles")
      .delete()
      .eq("user_id", userId)
      .lt("battle_time", cutoffIso),
    admin
      .from("analysis_history")
      .delete()
      .eq("user_id", userId)
      .lt("created_at", cutoffIso),
    admin
      .from("free_ai_usage")
      .delete()
      .eq("user_id", userId)
      .lt("usage_date", cutoffDate),
  ]);
}

export function createAdminClient(env: Env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function requireAdminClient(env: Env) {
  const client = createAdminClient(env);
  if (!client) {
    throw new Error("Supabase admin is not configured");
  }
  return client;
}

function limitsForTier(tier: SubscriptionTier) {
  return tier === "pro"
    ? { ...PRO_ANALYSIS_LIMITS }
    : { ...FREE_ANALYSIS_LIMITS };
}

async function readSubscriptionTier(
  admin: ReturnType<typeof requireAdminClient>,
  userId: string,
): Promise<SubscriptionTier> {
  const { data, error } = await admin
    .from("profiles")
    .select("subscription_tier")
    .eq("id", userId)
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(error.message);
  }

  return data?.subscription_tier === "pro" ? "pro" : "free";
}

/**
 * Reads the Pro beta opt-in flag for the agentic coach chat (AG7,
 * cr-gh7). Returns false when the user isn't in profiles or when the
 * column is null/undefined — default-deny so a new Pro user isn't
 * auto-enrolled.
 */
export async function readCoachAgentBetaOptIn(
  env: Env,
  userId: string,
): Promise<boolean> {
  const admin = createAdminClient(env);
  if (!admin) return false;
  const { data, error } = await admin
    .from("profiles")
    .select("coach_agent_beta_opt_in")
    .eq("id", userId)
    .maybeSingle();
  if (error && error.code !== "PGRST116") {
    throw new Error(error.message);
  }
  const row = data as { coach_agent_beta_opt_in?: boolean } | null;
  return row?.coach_agent_beta_opt_in === true;
}

/**
 * Writes the Pro beta opt-in flag. Uses the authenticated user's JWT
 * (not the service role) so Supabase RLS enforces ownership — a user
 * can only toggle their own flag. Returns the new value on success.
 */
export async function setCoachAgentBetaOptIn(
  env: Env,
  authorizationHeader: string | undefined,
  optIn: boolean,
): Promise<boolean> {
  const user = await requireAuthenticatedUser(env, authorizationHeader);
  // Use the admin client for the write so the single UPDATE is atomic
  // regardless of profile-table policies. The caller has already been
  // authenticated; we scope by user.id directly.
  const admin = requireAdminClient(env);
  const { error } = await admin
    .from("profiles")
    .update({ coach_agent_beta_opt_in: optIn })
    .eq("id", user.id);
  if (error) throw new Error(error.message);
  return optIn;
}

async function readManagedAiUsage(
  admin: ReturnType<typeof requireAdminClient>,
  userId: string,
): Promise<ManagedAiAccess["usage"]> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const sinceIso = today.toISOString();

  const [quickCountResponse, deepCountResponse] = await Promise.all([
    admin
      .from("analysis_history")
      .select("*", { head: true, count: "exact" })
      .eq("user_id", userId)
      .gte("created_at", sinceIso)
      .in("analysis_type", [...QUICK_ANALYSIS_TYPES]),
    admin
      .from("analysis_history")
      .select("*", { head: true, count: "exact" })
      .eq("user_id", userId)
      .gte("created_at", sinceIso)
      .eq("analysis_type", "deep_analysis"),
  ]);

  if (quickCountResponse.error) {
    throw new Error(quickCountResponse.error.message);
  }

  if (deepCountResponse.error) {
    throw new Error(deepCountResponse.error.message);
  }

  return {
    quick_analysis: quickCountResponse.count ?? 0,
    deep_analysis: deepCountResponse.count ?? 0,
  };
}

function todayUtcDate(): string {
  return new Date().toISOString().slice(0, 10);
}

async function readFreeAiUsage(
  admin: ReturnType<typeof requireAdminClient>,
  userId: string,
): Promise<number> {
  const { data, error } = await admin
    .from("free_ai_usage")
    .select("count")
    .eq("user_id", userId)
    .eq("usage_date", todayUtcDate())
    .maybeSingle();

  if (error && error.code !== "PGRST116") {
    throw new Error(error.message);
  }

  return typeof data?.count === "number" ? data.count : 0;
}

export async function incrementFreeAiUsage(
  env: Env,
  userId: string,
): Promise<number> {
  const admin = requireAdminClient(env);
  const { data, error } = await admin.rpc("increment_free_ai_usage", {
    p_user_id: userId,
    p_usage_date: todayUtcDate(),
  });

  if (error) {
    throw new Error(error.message);
  }

  if (typeof data !== "number") {
    throw new Error("Free AI usage counter returned an invalid result");
  }

  return data;
}

export async function requireAuthenticatedUser(
  env: Env,
  authorizationHeader: string | undefined,
): Promise<AuthenticatedUser> {
  const user = await getAuthenticatedUser(env, authorizationHeader);
  if (!user) {
    throw new HttpError(401, "Unauthorized");
  }
  return user;
}

function hasAuthorizationCredential(
  authorizationHeader: string | undefined,
): boolean {
  if (!authorizationHeader) {
    return false;
  }

  const value = authorizationHeader.trim();
  if (!value) {
    return false;
  }

  if (!value.startsWith("Bearer ")) {
    return true;
  }

  return value.slice("Bearer ".length).trim().length > 0;
}

export async function getAuthenticatedUser(
  env: Env,
  authorizationHeader: string | undefined,
): Promise<AuthenticatedUser | null> {
  if (!env.SUPABASE_URL || !env.SUPABASE_ANON_KEY || !authorizationHeader) {
    return null;
  }

  const token = authorizationHeader.startsWith("Bearer ")
    ? authorizationHeader.slice("Bearer ".length)
    : authorizationHeader;

  if (!token) {
    return null;
  }

  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      apikey: env.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as AuthenticatedUser;
  return payload;
}

export async function getManagedAiAccess(
  env: Env,
  authorizationHeader: string | undefined,
): Promise<ManagedAiAccess> {
  const user = await getAuthenticatedUser(env, authorizationHeader);
  if (
    !user &&
    hasAuthorizationCredential(authorizationHeader) &&
    env.SUPABASE_URL &&
    env.SUPABASE_ANON_KEY
  ) {
    throw new HttpError(401, "Unauthorized");
  }

  if (!user) {
    return {
      user: null,
      tier: "free",
      limits: limitsForTier("free"),
      usage: {
        quick_analysis: 0,
        deep_analysis: 0,
      },
      free_ai: {
        daily_limit: FREE_AI_DAILY_LIMIT,
        used_today: 0,
      },
    };
  }

  const admin = createAdminClient(env);
  if (!admin) {
    return {
      user,
      tier: "free",
      limits: limitsForTier("free"),
      usage: {
        quick_analysis: 0,
        deep_analysis: 0,
      },
      free_ai: {
        daily_limit: FREE_AI_DAILY_LIMIT,
        used_today: 0,
      },
    };
  }

  const [tier, usage, freeAiUsage] = await Promise.all([
    readSubscriptionTier(admin, user.id),
    readManagedAiUsage(admin, user.id),
    readFreeAiUsage(admin, user.id),
  ]);

  return {
    user,
    tier,
    limits: limitsForTier(tier),
    usage,
    free_ai: {
      daily_limit: FREE_AI_DAILY_LIMIT,
      used_today: freeAiUsage,
    },
  };
}

export async function persistSyncIfAuthorized(params: {
  env: Env;
  authorizationHeader: string | undefined;
  tag: string;
  player: Record<string, unknown>;
  battles: RawBattle[];
}): Promise<void> {
  const user = await getAuthenticatedUser(
    params.env,
    params.authorizationHeader,
  );
  const admin = createAdminClient(params.env);
  if (!user || !admin) {
    return;
  }

  const normalizedTag = normalizeTag(params.tag);
  const nowIso = new Date().toISOString();
  const snapshotDate = nowIso.slice(0, 10);

  await admin.from("tracked_players").upsert(
    {
      user_id: user.id,
      player_tag: normalizedTag,
      player_name: String(params.player.name ?? ""),
      last_synced_at: nowIso,
    },
    { onConflict: "user_id,player_tag" },
  );

  await admin.from("player_snapshots").upsert(
    {
      user_id: user.id,
      player_tag: normalizedTag,
      snapshot_date: snapshotDate,
      trophies: params.player.trophies ?? null,
      best_trophies: params.player.bestTrophies ?? null,
      wins: params.player.wins ?? null,
      losses: params.player.losses ?? null,
      battle_count: params.player.battleCount ?? null,
      three_crown_wins: params.player.threeCrownWins ?? null,
      challenge_max_wins: params.player.challengeMaxWins ?? null,
      challenge_cards_won: params.player.challengeCardsWon ?? null,
      war_day_wins: params.player.warDayWins ?? null,
      clan_war_trophies: params.player.clanWarTrophies ?? null,
      donations: params.player.donations ?? null,
      donations_received: params.player.donationsReceived ?? null,
      total_donations: params.player.totalDonations ?? null,
      arena_name:
        typeof params.player.arena === "object" &&
        params.player.arena !== null &&
        "name" in params.player.arena
          ? params.player.arena.name
          : null,
      exp_level: params.player.expLevel ?? null,
      star_points: params.player.starPoints ?? null,
    },
    { onConflict: "user_id,player_tag,snapshot_date" },
  );

  const records = params.battles
    .map((battle) => battleInsertRecord(battle, normalizedTag, user.id))
    .filter((record): record is Record<string, unknown> => record !== null);

  if (records.length > 0) {
    await admin.from("battles").upsert(records, {
      onConflict: "user_id,player_tag,battle_time",
      ignoreDuplicates: false,
    });
  }

  await enforceUserRetention(
    admin,
    user.id,
    (await readPrivacySettings(admin, user.id)).data_retention_days,
  );
}

export async function getSubscriptionStatus(
  env: Env,
  authorizationHeader: string | undefined,
  userId: string,
): Promise<{
  user_id: string;
  tier: "free" | "pro";
  limits: { quick_analysis: number; deep_analysis: number };
  usage_today: { quick_analysis: number; deep_analysis: number };
}> {
  const user = await getAuthenticatedUser(env, authorizationHeader);
  if (!user || user.id !== userId) {
    throw new HttpError(401, "Unauthorized");
  }

  const admin = createAdminClient(env);
  if (!admin) {
    return {
      user_id: userId,
      tier: "free",
      limits: limitsForTier("free"),
      usage_today: { quick_analysis: 0, deep_analysis: 0 },
    };
  }

  const tier = await readSubscriptionTier(admin, userId);
  const usage_today = await readManagedAiUsage(admin, userId);
  return {
    user_id: userId,
    tier,
    limits: limitsForTier(tier),
    usage_today,
  };
}

export async function applySubscriptionUpdate(
  env: Env,
  payload: {
    user_id: string;
    subscription_id: string;
    subscription_status: string;
    subscription_tier: "free" | "pro";
  },
): Promise<void> {
  const admin = createAdminClient(env);
  if (!admin) {
    return;
  }

  const { error } = await admin
    .from("profiles")
    .update({
      subscription_id: payload.subscription_id,
      subscription_status: payload.subscription_status,
      subscription_tier: payload.subscription_tier,
    })
    .eq("id", payload.user_id);

  if (error) {
    throw new Error(error.message);
  }
}

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export type SubscriptionWebhookRecordResult =
  | "inserted"
  | "duplicate"
  | "skipped";

/**
 * Persist webhook payload for audit + idempotency (same raw body = duplicate).
 * When Supabase admin is not configured, returns "skipped" so callers can
 * still apply updates in dev/tests without the events table.
 */
export async function tryRecordSubscriptionWebhookEvent(
  env: Env,
  rawBody: string,
  event: {
    user_id: string;
    subscription_id: string;
    subscription_status: string;
    subscription_tier: SubscriptionTier;
    payload: unknown;
  },
): Promise<SubscriptionWebhookRecordResult> {
  const admin = createAdminClient(env);
  if (!admin) {
    return "skipped";
  }

  const idempotency_key = await sha256Hex(rawBody);
  const { error } = await admin.from("subscription_webhook_events").insert({
    idempotency_key,
    user_id: event.user_id,
    subscription_id: event.subscription_id,
    subscription_status: event.subscription_status,
    subscription_tier: event.subscription_tier,
    payload: event.payload as Record<string, unknown>,
  });

  const duplicate =
    error?.code === "23505" ||
    (typeof error?.message === "string" &&
      error.message.toLowerCase().includes("duplicate"));
  if (duplicate) {
    return "duplicate";
  }

  if (error) {
    throw new Error(error.message);
  }

  return "inserted";
}

export async function listTrackedPlayers(
  env: Env,
  authorizationHeader: string | undefined,
): Promise<TrackedPlayerRecord[]> {
  const user = await requireAuthenticatedUser(env, authorizationHeader);
  const admin = requireAdminClient(env);
  const { data, error } = await admin
    .from("tracked_players")
    .select("*")
    .eq("user_id", user.id)
    .order("added_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as TrackedPlayerRecord[];
}

export async function deleteTrackedPlayer(
  env: Env,
  authorizationHeader: string | undefined,
  trackedPlayerId: string,
): Promise<void> {
  const user = await requireAuthenticatedUser(env, authorizationHeader);
  const admin = requireAdminClient(env);
  const { error } = await admin
    .from("tracked_players")
    .delete()
    .eq("id", trackedPlayerId)
    .eq("user_id", user.id);

  if (error) {
    throw new Error(error.message);
  }
}

export async function createAnalysisHistory(
  env: Env,
  authorizationHeader: string | undefined,
  payload: {
    player_tag: string;
    analysis_type: string;
    prompt?: string;
    result: string;
    model?: string;
  },
): Promise<AnalysisHistoryRecord> {
  const user = await requireAuthenticatedUser(env, authorizationHeader);
  const admin = requireAdminClient(env);
  const { data, error } = await admin
    .from("analysis_history")
    .insert({
      user_id: user.id,
      player_tag: normalizeTag(payload.player_tag),
      analysis_type: payload.analysis_type,
      prompt: payload.prompt ?? null,
      result: payload.result,
      model: payload.model ?? null,
    })
    .select("*")
    .single();

  if (error) {
    throw new Error(error.message);
  }

  await enforceUserRetention(
    admin,
    user.id,
    (await readPrivacySettings(admin, user.id)).data_retention_days,
  );

  return data as AnalysisHistoryRecord;
}

export async function recordManagedAiAnalysis(
  env: Env,
  authorizationHeader: string | undefined,
  payload: {
    player_tag: string;
    analysis_type:
      | "quick_stats"
      | "deck_tips"
      | "battle_summary"
      | "deep_analysis";
    prompt?: string;
    result: string;
    model?: string;
  },
): Promise<void> {
  const user = await getAuthenticatedUser(env, authorizationHeader);
  const admin = createAdminClient(env);

  if (!user || !admin) {
    return;
  }

  const { error } = await admin.from("analysis_history").insert({
    user_id: user.id,
    player_tag: normalizeTag(payload.player_tag),
    analysis_type: payload.analysis_type,
    prompt: payload.prompt ?? null,
    result: payload.result,
    model: payload.model ?? null,
  });

  if (error) {
    throw new Error(error.message);
  }

  await enforceUserRetention(
    admin,
    user.id,
    (await readPrivacySettings(admin, user.id)).data_retention_days,
  );
}

export async function listAnalysisHistory(
  env: Env,
  authorizationHeader: string | undefined,
  options: {
    playerTag?: string;
    limit?: number;
  },
): Promise<AnalysisHistoryRecord[]> {
  const user = await requireAuthenticatedUser(env, authorizationHeader);
  const admin = requireAdminClient(env);

  let query = admin
    .from("analysis_history")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(options.limit ?? 20);

  if (options.playerTag) {
    query = query.eq("player_tag", normalizeTag(options.playerTag));
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as AnalysisHistoryRecord[];
}

export async function getPrivacySettings(
  env: Env,
  authorizationHeader: string | undefined,
): Promise<PrivacySettings> {
  const user = await requireAuthenticatedUser(env, authorizationHeader);
  const admin = requireAdminClient(env);
  return readPrivacySettings(admin, user.id);
}

export async function updatePrivacySettings(
  env: Env,
  authorizationHeader: string | undefined,
  payload: {
    data_retention_days?: number;
    privacy_policy_version?: string;
    acknowledge_privacy_policy?: boolean;
    acknowledge_byok_local_storage_notice?: boolean;
  },
): Promise<PrivacySettings> {
  const user = await requireAuthenticatedUser(env, authorizationHeader);
  const admin = requireAdminClient(env);
  const nowIso = new Date().toISOString();
  const updates: Record<string, unknown> = {};

  if (payload.data_retention_days !== undefined) {
    updates.data_retention_days = sanitizeRetentionDays(
      payload.data_retention_days,
    );
  }

  if (payload.privacy_policy_version?.trim()) {
    updates.privacy_policy_version = payload.privacy_policy_version.trim();
  }

  if (payload.acknowledge_privacy_policy) {
    updates.privacy_policy_accepted_at = nowIso;
  }

  if (payload.acknowledge_byok_local_storage_notice) {
    updates.byok_local_storage_notice_accepted_at = nowIso;
  }

  if (Object.keys(updates).length > 0) {
    const { error } = await admin.from("profiles").upsert(
      {
        id: user.id,
        ...updates,
      },
      { onConflict: "id" },
    );

    if (error) {
      throw new Error(error.message);
    }
  }

  const settings = await readPrivacySettings(admin, user.id);
  await enforceUserRetention(admin, user.id, settings.data_retention_days);
  return settings;
}

export async function exportUserData(
  env: Env,
  authorizationHeader: string | undefined,
): Promise<PrivacyExportPayload> {
  const user = await requireAuthenticatedUser(env, authorizationHeader);
  const admin = requireAdminClient(env);

  const [
    profileResponse,
    trackedPlayersResponse,
    snapshotsResponse,
    battlesResponse,
    decksResponse,
    deckStatsResponse,
    analysisResponse,
    freeAiUsageResponse,
    privacySettings,
  ] = await Promise.all([
    admin.from("profiles").select("*").eq("id", user.id).maybeSingle(),
    admin
      .from("tracked_players")
      .select("*")
      .eq("user_id", user.id)
      .order("added_at", { ascending: false }),
    admin
      .from("player_snapshots")
      .select("*")
      .eq("user_id", user.id)
      .order("snapshot_date", { ascending: false }),
    admin
      .from("battles")
      .select("*")
      .eq("user_id", user.id)
      .order("battle_time", { ascending: false }),
    admin
      .from("favorite_decks")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    admin
      .from("deck_stats")
      .select("*")
      .eq("user_id", user.id)
      .order("last_used_at", { ascending: false }),
    admin
      .from("analysis_history")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false }),
    admin
      .from("free_ai_usage")
      .select("*")
      .eq("user_id", user.id)
      .order("usage_date", { ascending: false }),
    readPrivacySettings(admin, user.id),
  ]);

  const responses = [
    profileResponse,
    trackedPlayersResponse,
    snapshotsResponse,
    battlesResponse,
    decksResponse,
    deckStatsResponse,
    analysisResponse,
    freeAiUsageResponse,
  ];

  for (const response of responses) {
    if (response.error) {
      throw new Error(response.error.message);
    }
  }

  return {
    exported_at: new Date().toISOString(),
    user,
    privacy_settings: privacySettings,
    data: {
      profile: (profileResponse.data as Record<string, unknown> | null) ?? null,
      tracked_players: (trackedPlayersResponse.data ??
        []) as TrackedPlayerRecord[],
      player_snapshots: (snapshotsResponse.data ?? []) as Record<
        string,
        unknown
      >[],
      battles: (battlesResponse.data ?? []) as Record<string, unknown>[],
      favorite_decks: (decksResponse.data ?? []) as Record<string, unknown>[],
      deck_stats: (deckStatsResponse.data ?? []) as Record<string, unknown>[],
      analysis_history: (analysisResponse.data ??
        []) as AnalysisHistoryRecord[],
      free_ai_usage: (freeAiUsageResponse.data ?? []) as Record<
        string,
        unknown
      >[],
    },
    notes: {
      browser_only_data_excluded: [
        "Custom BYOK model config stored in local browser storage",
        "Last searched player tag stored in local browser storage",
        "Local usage counters stored in local browser storage",
      ],
    },
  };
}

export async function eraseUserData(
  env: Env,
  authorizationHeader: string | undefined,
): Promise<void> {
  const user = await requireAuthenticatedUser(env, authorizationHeader);
  const admin = requireAdminClient(env);

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error("Supabase admin is not configured");
  }

  // Delete the auth user; profile and app tables cascade from auth.users -> profiles -> child tables.
  const response = await fetch(
    `${env.SUPABASE_URL}/auth/v1/admin/users/${user.id}`,
    {
      method: "DELETE",
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      },
    },
  );

  if (!response.ok) {
    // Log the upstream body for support correlation; do NOT bake it into
    // the thrown Error message because the route handler used to surface
    // that text to the client. Pre-fix this threw
    //   new Error(`Failed to erase user data: <body>`)
    // which echoed Supabase response details (codes, row hints, occasionally
    // user identifiers) back to the API caller.
    const body = await response.text().catch(() => "");
    console.error(
      JSON.stringify({
        level: "error",
        op: "supabase.eraseUserData",
        status: response.status,
        body,
      }),
    );
    throw new Error(
      `Failed to erase user data (upstream status ${response.status})`,
    );
  }

  // Best-effort cleanup for rows that may exist without a valid profile relation.
  await Promise.all([
    admin.from("tracked_players").delete().eq("user_id", user.id),
    admin.from("player_snapshots").delete().eq("user_id", user.id),
    admin.from("battles").delete().eq("user_id", user.id),
    admin.from("favorite_decks").delete().eq("user_id", user.id),
    admin.from("deck_stats").delete().eq("user_id", user.id),
    admin.from("analysis_history").delete().eq("user_id", user.id),
    admin.from("free_ai_usage").delete().eq("user_id", user.id),
    admin.from("profiles").delete().eq("id", user.id),
  ]);
}
