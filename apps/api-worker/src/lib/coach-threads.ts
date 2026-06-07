/**
 * @fileoverview Supabase helpers for the agentic coach chat (AG4, cr-dn6).
 *
 * Wraps CRUD against the `coach_threads` and `coach_messages` tables
 * introduced by supabase/migrations/006_coach_threads.sql (AG1). Kept
 * separate from the already-large lib/supabase.ts module so the agent
 * chat feature has a focused, testable surface.
 *
 * RLS in the migration enforces user scoping at the database level.
 * These helpers nonetheless always include user_id in WHERE clauses
 * (defense in depth — if RLS is ever disabled, the worker still can't
 * read across users).
 */

import { requireAdminClient, requireAuthenticatedUser } from "./supabase";
import { normalizeTag } from "./tags";
import type { AnthropicMessage } from "./agent";
import type { Env } from "../types";

export interface CoachThreadRecord {
  id: string;
  user_id: string;
  player_tag: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface CoachMessageRecord {
  id: string;
  thread_id: string;
  role: "user" | "assistant";
  /**
   * JSON-decoded content. May be a plain string (simple user messages)
   * or an Anthropic content-block array (assistant messages carrying
   * tool_use, user messages carrying tool_result).
   */
  content: unknown;
  tool_calls: unknown | null;
  created_at: string;
}

/**
 * Creates a new thread for the authenticated user. Returns the full
 * thread row. RLS guarantees the user_id is the caller.
 */
export async function createCoachThread(
  env: Env,
  authorizationHeader: string | undefined,
  params: { player_tag: string; title?: string },
): Promise<CoachThreadRecord> {
  const user = await requireAuthenticatedUser(env, authorizationHeader);
  const admin = requireAdminClient(env);
  const { data, error } = await admin
    .from("coach_threads")
    .insert({
      user_id: user.id,
      player_tag: normalizeTag(params.player_tag),
      title: params.title ?? null,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as CoachThreadRecord;
}

/**
 * Fetches an existing thread by id if-and-only-if it belongs to the
 * authenticated user. Returns null when the thread doesn't exist or
 * belongs to someone else (handled identically to avoid leaking
 * ownership to a probing client).
 */
export async function getCoachThread(
  env: Env,
  authorizationHeader: string | undefined,
  threadId: string,
): Promise<CoachThreadRecord | null> {
  const user = await requireAuthenticatedUser(env, authorizationHeader);
  const admin = requireAdminClient(env);
  const { data, error } = await admin
    .from("coach_threads")
    .select("*")
    .eq("id", threadId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return (data as CoachThreadRecord | null) ?? null;
}

/**
 * Lists messages on a thread in insertion order. The caller is
 * responsible for verifying thread ownership via getCoachThread()
 * beforehand; this function uses the same user_id join shape as the
 * RLS policy to double-enforce isolation.
 */
export async function listCoachMessages(
  env: Env,
  authorizationHeader: string | undefined,
  threadId: string,
): Promise<CoachMessageRecord[]> {
  const user = await requireAuthenticatedUser(env, authorizationHeader);
  const admin = requireAdminClient(env);
  // Join through coach_threads to verify ownership in a single round-trip.
  const { data, error } = await admin
    .from("coach_messages")
    .select("*, coach_threads!inner(user_id)")
    .eq("thread_id", threadId)
    .eq("coach_threads.user_id", user.id)
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  // Strip the nested join row before returning.
  return (
    (data ?? []) as (CoachMessageRecord & { coach_threads?: unknown })[]
  ).map(({ coach_threads: _drop, ...message }) => message);
}

/**
 * Appends a single message to a thread. Does not verify ownership —
 * callers must have already established it (typically via the same
 * getCoachThread() check used to hydrate history at the start of a
 * turn). The DB's RLS policies will still reject writes from the
 * wrong user as a backstop.
 */
export async function appendCoachMessage(
  env: Env,
  authorizationHeader: string | undefined,
  params: {
    thread_id: string;
    role: "user" | "assistant";
    content: unknown;
    tool_calls?: unknown;
  },
): Promise<CoachMessageRecord> {
  // Even though we don't need the user for the insert, pulling it here
  // forces a valid JWT and aborts with 401 on an unauthenticated call.
  await requireAuthenticatedUser(env, authorizationHeader);
  const admin = requireAdminClient(env);
  const { data, error } = await admin
    .from("coach_messages")
    .insert({
      thread_id: params.thread_id,
      role: params.role,
      content: params.content as never,
      tool_calls: (params.tool_calls ?? null) as never,
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as CoachMessageRecord;
}

/**
 * Converts a persisted CoachMessageRecord back into the AnthropicMessage
 * shape the orchestrator expects. Handles both string content and the
 * content-block array form used for tool_use/tool_result turns.
 */
export function messageRecordToAnthropic(
  record: CoachMessageRecord,
): AnthropicMessage {
  const content = record.content;
  if (typeof content === "string") {
    return { role: record.role, content };
  }
  if (Array.isArray(content)) {
    // We trust the DB shape; it was written by us. If the content
    // is malformed we'd rather let Anthropic complain than silently
    // drop context.
    return {
      role: record.role,
      content: content as AnthropicMessage["content"],
    };
  }
  // Anything else is a programming error somewhere upstream; fall back
  // to an empty string so the conversation still loads.
  return { role: record.role, content: "" };
}
