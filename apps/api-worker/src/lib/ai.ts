import type { Env, NormalizedBattle, PlayerState } from "../types";

export type AiTextProvider =
  | "deterministic"
  | "anthropic"
  | "workers_ai"
  | "custom";

interface GenerationOptions {
  allowLiveModel?: boolean;
  provider?: AiTextProvider;
  /**
   * Mutable telemetry sink. Callers pass an object; the dispatcher fills in
   * fields so the caller can emit analytics without re-deriving provider
   * state. Currently: fallback_used (true when custom lane was tried and
   * fell back to Anthropic).
   */
  telemetry?: { fallback_used?: boolean };
}

const DEFAULT_WORKERS_AI_MODEL = "@cf/openai/gpt-oss-20b";
/** Anthropic REST call ceiling (Workers fetch + model latency). */
const ANTHROPIC_FETCH_TIMEOUT_MS = 120_000;
/** Workers AI / gateway round-trip ceiling for free-lane calls. */
const WORKERS_AI_TIMEOUT_MS = 90_000;
/** Self-hosted (garage) fine-tune round-trip ceiling. */
const CUSTOM_MODEL_TIMEOUT_MS = 60_000;

export class AiProviderUnavailableError extends Error {
  constructor(
    public readonly provider: Exclude<AiTextProvider, "deterministic">,
  ) {
    super("coaching_unavailable");
  }
}

export class FreeLanePoolExhaustedError extends Error {
  constructor() {
    super("free_lane_pool_exhausted");
  }
}

function anthropicHeaders(env: Env): HeadersInit {
  return {
    "content-type": "application/json",
    "x-api-key": env.ANTHROPIC_API_KEY ?? "",
    "anthropic-version": "2023-06-01",
  };
}

function readAnthropicText(payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "content" in payload &&
    Array.isArray(payload.content)
  ) {
    return payload.content
      .flatMap((item) =>
        typeof item === "object" &&
        item !== null &&
        "text" in item &&
        typeof item.text === "string"
          ? [item.text]
          : [],
      )
      .join("\n")
      .trim();
  }
  return "";
}

async function anthropicText(
  env: Env,
  system: string,
  user: string,
  maxTokens = 900,
): Promise<string | null> {
  if (!env.ANTHROPIC_API_KEY) {
    return null;
  }

  let response: Response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: anthropicHeaders(env),
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL ?? "claude-sonnet-4-20250514",
        max_tokens: maxTokens,
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(ANTHROPIC_FETCH_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      return null;
    }
    throw error;
  }

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as unknown;
  const text = readAnthropicText(payload);
  return text.length > 0 ? text : null;
}

function providerFor(options: GenerationOptions): AiTextProvider {
  if (options.provider) {
    return options.provider;
  }

  return options.allowLiveModel === false ? "deterministic" : "anthropic";
}

function isPoolExhaustionError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    return false;
  }

  const status =
    "status" in error && typeof error.status === "number" ? error.status : null;
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message
      : "";
  const lowerMessage = message.toLowerCase();

  return (
    status === 429 ||
    lowerMessage.includes("429") ||
    lowerMessage.includes("rate limit") ||
    lowerMessage.includes("too many requests")
  );
}

function readTextCandidate(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function readWorkersAiText(payload: unknown): string {
  const directText = readTextCandidate(payload);
  if (directText) {
    return directText;
  }

  if (typeof payload !== "object" || payload === null) {
    return "";
  }

  const record = payload as Record<string, unknown>;
  const simpleText =
    readTextCandidate(record.response) ??
    readTextCandidate(record.output_text) ??
    readTextCandidate(record.text);
  if (simpleText) {
    return simpleText;
  }

  if (typeof record.result === "object" && record.result !== null) {
    const resultText = readWorkersAiText(record.result);
    if (resultText) {
      return resultText;
    }
  }

  if (Array.isArray(record.choices)) {
    const [firstChoice] = record.choices;
    if (typeof firstChoice === "object" && firstChoice !== null) {
      const choice = firstChoice as Record<string, unknown>;
      if (typeof choice.message === "object" && choice.message !== null) {
        const message = choice.message as Record<string, unknown>;
        const messageText = readTextCandidate(message.content);
        if (messageText) {
          return messageText;
        }
      }

      const choiceText = readTextCandidate(choice.text);
      if (choiceText) {
        return choiceText;
      }
    }
  }

  return "";
}

async function workersAiText(
  env: Env,
  system: string,
  user: string,
  maxTokens = 500,
): Promise<string> {
  if (!env.AI) {
    throw new AiProviderUnavailableError("workers_ai");
  }

  const model = env.WORKERS_AI_MODEL?.trim() || DEFAULT_WORKERS_AI_MODEL;

  const aiOptions = env.AI_GATEWAY_ID
    ? {
        gateway: {
          id: env.AI_GATEWAY_ID,
          collectLog: true,
          requestTimeoutMs: WORKERS_AI_TIMEOUT_MS,
        },
        tags: ["coachroyale:free"] as string[],
        signal: AbortSignal.timeout(WORKERS_AI_TIMEOUT_MS),
      }
    : {
        tags: ["coachroyale:free"] as string[],
        signal: AbortSignal.timeout(WORKERS_AI_TIMEOUT_MS),
      };

  try {
    const payload = await env.AI.run(
      model,
      {
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        max_tokens: maxTokens,
      },
      aiOptions,
    );
    const text = readWorkersAiText(payload);
    if (!text) {
      throw new AiProviderUnavailableError("workers_ai");
    }
    return text;
  } catch (error) {
    if (error instanceof AiProviderUnavailableError) {
      throw error;
    }
    if (isPoolExhaustionError(error)) {
      throw new FreeLanePoolExhaustedError();
    }
    throw new AiProviderUnavailableError("workers_ai");
  }
}

/**
 * Calls the operator-hosted fine-tuned model via an OpenAI-compatible endpoint.
 *
 * Silent-null contract: every failure mode (missing config, network error,
 * non-OK response, timeout, malformed body) returns `null`. Callers are
 * expected to fall back to another provider on null so the user never sees
 * a hard failure from this lane.
 */
export async function customModelText(
  env: Env,
  system: string,
  user: string,
  maxTokens = 700,
): Promise<string | null> {
  if (
    !env.CUSTOM_MODEL_URL ||
    !env.CUSTOM_MODEL_KEY ||
    !env.CUSTOM_MODEL_NAME
  ) {
    return null;
  }

  const base = env.CUSTOM_MODEL_URL.replace(/\/+$/, "");
  const endpoint = `${base}/chat/completions`;

  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${env.CUSTOM_MODEL_KEY}`,
  };
  if (env.CUSTOM_MODEL_SHARED_SECRET) {
    headers["X-Custom-Model-Auth"] = env.CUSTOM_MODEL_SHARED_SECRET;
  }

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: env.CUSTOM_MODEL_NAME,
        max_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(CUSTOM_MODEL_TIMEOUT_MS),
    });
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    return null;
  }

  const text = readWorkersAiText(payload);
  return text.length > 0 ? text : null;
}

async function requireAnthropicText(
  env: Env,
  system: string,
  user: string,
  maxTokens: number,
): Promise<string> {
  const text = await anthropicText(env, system, user, maxTokens).catch(
    () => null,
  );
  if (!text) {
    throw new AiProviderUnavailableError("anthropic");
  }
  return text;
}

/**
 * Tries the operator-hosted custom lane. On any failure (null return), falls
 * back to requireAnthropicText so the caller is guaranteed a string or a
 * typed AiProviderUnavailableError("anthropic") if Anthropic also fails.
 *
 * Records whether fallback was used on options.telemetry so callers can emit
 * a metric indicating custom-lane health without double-counting requests.
 */
async function customWithAnthropicFallback(
  env: Env,
  system: string,
  user: string,
  maxTokens: number,
  telemetry?: { fallback_used?: boolean },
): Promise<string> {
  const customText = await customModelText(env, system, user, maxTokens);
  if (customText !== null) {
    if (telemetry) {
      telemetry.fallback_used = false;
    }
    return customText;
  }
  if (telemetry) {
    telemetry.fallback_used = true;
  }
  return requireAnthropicText(env, system, user, maxTokens);
}

function analyticsSummary(playerState: PlayerState): string {
  return [
    `Overall win rate: ${Math.round(playerState.win_rate_overall * 100)}%.`,
    `Trend: ${playerState.trend_direction} with ${Math.round(playerState.trend_strength * 100)}% strength.`,
    `Deck stability: ${Math.round(playerState.deck_stability_score * 100)}%.`,
    playerState.worst_matchups[0]
      ? `Toughest matchup: ${playerState.worst_matchups[0].archetype} at ${Math.round(
          playerState.worst_matchups[0].win_rate * 100,
        )}%.`
      : "Not enough matchup data yet.",
    playerState.tilt_impact !== null
      ? `Tilt impact: ${Math.round(playerState.tilt_impact * 100)}% versus baseline.`
      : "No reliable tilt signal yet.",
  ].join(" ");
}

export async function generateAnalysisText(
  env: Env,
  player: Record<string, unknown>,
  playerState: PlayerState,
  battles: NormalizedBattle[],
  options: GenerationOptions = {},
): Promise<string> {
  const fallback = [
    `Player ${String(player.name ?? player.tag ?? "unknown")} is sitting at ${playerState.trophies} trophies.`,
    analyticsSummary(playerState),
    playerState.best_deck
      ? `Best deck sample: ${playerState.best_deck.cards.join(", ")}.`
      : "No strong deck sample yet.",
    "Priority action: stay on one stable deck for 20 games and review losses against your worst matchup.",
  ].join(" ");

  const provider = providerFor(options);
  if (provider === "deterministic") {
    return fallback;
  }

  const system =
    "You are an elite Clash Royale coach. Provide concise, actionable advice in plain text.";
  const user = JSON.stringify({
    player,
    player_state: playerState,
    recent_battles: battles.slice(0, 10),
  });

  if (provider === "workers_ai") {
    return workersAiText(env, system, user, 500);
  }

  if (provider === "custom") {
    return customWithAnthropicFallback(
      env,
      system,
      user,
      700,
      options.telemetry,
    );
  }

  return requireAnthropicText(env, system, user, 700);
}

export async function generateQuickResponse(
  env: Env,
  prompt: string,
  playerData: Record<string, unknown>,
  type: string,
  options: GenerationOptions = {},
): Promise<string> {
  const fallback = `${type.replaceAll("_", " ")}: ${prompt} Player: ${String(
    playerData.name ?? playerData.tag ?? "unknown",
  )}.`;

  const provider = providerFor(options);
  if (provider === "deterministic") {
    return fallback;
  }

  const system =
    "You are a Clash Royale analyst. Keep the answer under 150 words and use bullets when helpful.";
  const user = JSON.stringify({ prompt, playerData, type });

  if (provider === "workers_ai") {
    return workersAiText(env, system, user, 500);
  }

  if (provider === "custom") {
    return customWithAnthropicFallback(
      env,
      system,
      user,
      450,
      options.telemetry,
    );
  }

  return requireAnthropicText(env, system, user, 450);
}

export async function generateWeeklyPlan(
  env: Env,
  playerState: PlayerState,
  options: GenerationOptions = {},
): Promise<{
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
}> {
  const defaultPlan = {
    coaching_summary: analyticsSummary(playerState),
    performance_verdict:
      playerState.trend_direction === "improving"
        ? "Improving"
        : playerState.trend_direction === "declining"
          ? "Needs correction"
          : "Plateau",
    confidence: playerState.trend_confidence,
    top_priority: {
      title: "Stabilize one ladder deck",
      description:
        "Reduce deck switching and collect a cleaner 20-game sample on one primary deck.",
      evidence:
        playerState.best_deck?.cards.join(", ") ??
        "Not enough stable deck data yet.",
      expected_impact:
        "More reliable matchup learning and fewer avoidable losses.",
    },
    weekly_goals: [
      {
        goal: "Play one main deck for 20 games",
        metric: "Unique decks in last 20 <= 2",
        how: "Queue only with your primary deck unless testing in friendlies.",
      },
      {
        goal: "Review toughest matchup losses",
        metric: "Watch 3 replays",
        how: "Focus on first big elixir swing and tower damage timing.",
      },
    ],
    drills: [
      {
        name: "Opening rotation drill",
        description:
          "Practice safe first four cards and avoid overcommitting before double elixir.",
        sessions_per_day: 2,
      },
      {
        name: "Loss-reset drill",
        description:
          "Take a two minute reset after every second straight loss.",
        sessions_per_day: 2,
      },
    ],
    deck_recommendation: {
      verdict: playerState.best_deck
        ? "Keep current primary deck"
        : "Collect more data",
      reasoning: playerState.best_deck
        ? `Your strongest sample deck is running at ${Math.round(playerState.best_deck.win_rate * 100)}%.`
        : "There is not enough deck sample size yet for a confident swap recommendation.",
      suggested_swap: null,
    },
    matchup_alerts: playerState.worst_matchups.map((matchup) => ({
      archetype: matchup.archetype,
      win_rate: matchup.win_rate,
      tip: "Play lower-risk defense first and only counterpush after a positive trade.",
    })),
    tilt_note:
      playerState.tilt_impact !== null && playerState.tilt_impact < 0
        ? "Your post-loss performance drops. Stop queueing after two straight losses."
        : null,
    confidence_builders: [
      "Track one replay lesson each day.",
      "Queue in your best time slot when possible.",
    ],
  };

  if (options.allowLiveModel === false) {
    return defaultPlan;
  }

  const system =
    "You are an elite Clash Royale coach. Return only valid JSON matching the requested structure.";
  const user = `Return a JSON weekly plan for this player state: ${JSON.stringify(playerState)}`;

  let modelText: string | null = null;
  if (options.provider === "custom") {
    modelText = await customModelText(env, system, user, 900);
    if (modelText === null && options.telemetry) {
      options.telemetry.fallback_used = true;
    } else if (modelText !== null && options.telemetry) {
      options.telemetry.fallback_used = false;
    }
  }
  if (modelText === null) {
    modelText = await anthropicText(env, system, user, 900);
  }

  if (!modelText) {
    return defaultPlan;
  }

  try {
    const parsed = JSON.parse(modelText) as typeof defaultPlan;
    return parsed;
  } catch {
    return defaultPlan;
  }
}

export async function answerCoachQuestion(
  env: Env,
  question: string,
  playerState: PlayerState,
  options: GenerationOptions = {},
): Promise<string> {
  const fallback = `${question}\n\nBased on your current analytics, focus on ${playerState.best_deck ? "your strongest deck" : "a single stable deck"}, respect your worst matchup, and queue during your stronger time window when possible.`;

  if (options.allowLiveModel === false) {
    return fallback;
  }

  const system =
    "You are an elite Clash Royale coach. Answer in plain text with direct, tactical advice.";
  const user = JSON.stringify({ question, player_state: playerState });

  if (options.provider === "custom") {
    const customText = await customModelText(env, system, user, 700);
    if (customText !== null) {
      if (options.telemetry) {
        options.telemetry.fallback_used = false;
      }
      return customText;
    }
    if (options.telemetry) {
      options.telemetry.fallback_used = true;
    }
  }

  const anthropic = await anthropicText(env, system, user, 700);
  return anthropic ?? fallback;
}
