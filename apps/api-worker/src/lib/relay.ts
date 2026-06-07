import type { Env } from "../types";
import { fetchJson } from "./http";
import { encodeTag } from "./tags";

function getRelayBaseUrl(env: Env): string {
  if (!env.RELAY_BASE_URL) {
    throw new Error("RELAY_BASE_URL is not configured");
  }
  return env.RELAY_BASE_URL.replace(/\/$/, "");
}

function relayHeaders(env: Env, requestId?: string): HeadersInit {
  if (!env.RELAY_SHARED_SECRET) {
    throw new Error("RELAY_SHARED_SECRET is not configured");
  }
  const headers: Record<string, string> = {
    "X-Relay-Auth": env.RELAY_SHARED_SECRET,
  };
  if (requestId) {
    headers["X-Request-ID"] = requestId;
  }
  return headers;
}

export async function fetchRelayPlayer<T>(
  env: Env,
  tag: string,
  requestId?: string,
): Promise<T> {
  return fetchJson<T>(
    `${getRelayBaseUrl(env)}/relay/player/${encodeTag(tag)}`,
    {
      headers: relayHeaders(env, requestId),
    },
  );
}

export async function fetchRelayBattles<T>(
  env: Env,
  tag: string,
  requestId?: string,
): Promise<T> {
  return fetchJson<T>(
    `${getRelayBaseUrl(env)}/relay/player/${encodeTag(tag)}/battles`,
    {
      headers: relayHeaders(env, requestId),
    },
  );
}

export async function fetchRelayChests<T>(
  env: Env,
  tag: string,
  requestId?: string,
): Promise<T> {
  return fetchJson<T>(
    `${getRelayBaseUrl(env)}/relay/player/${encodeTag(tag)}/chests`,
    {
      headers: relayHeaders(env, requestId),
    },
  );
}

export async function fetchRelayClan<T>(
  env: Env,
  tag: string,
  requestId?: string,
): Promise<T> {
  return fetchJson<T>(`${getRelayBaseUrl(env)}/relay/clan/${encodeTag(tag)}`, {
    headers: relayHeaders(env, requestId),
  });
}

export async function fetchRelayCards<T>(
  env: Env,
  requestId?: string,
): Promise<T> {
  return fetchJson<T>(`${getRelayBaseUrl(env)}/relay/cards`, {
    headers: relayHeaders(env, requestId),
  });
}
