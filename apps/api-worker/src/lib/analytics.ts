import type {
  DeckStat,
  MatchupStat,
  NormalizedBattle,
  PlayerState,
} from "../types";

const ARCHETYPE_KEYWORDS: Record<string, string[]> = {
  "Lava Loon": ["lava hound", "balloon", "lumberjack"],
  "Golem Beatdown": ["golem", "night witch", "baby dragon"],
  "X-Bow Siege": ["x-bow", "tesla"],
  Mortar: ["mortar", "bats"],
  "3 Musketeers": ["three musketeers", "battle ram"],
  "Bridge Spam": ["battle ram", "bandit", "dark prince"],
  "Spell Bait": ["goblin barrel", "princess", "goblin gang"],
  "Miner Wall Breakers": ["miner", "wall breakers"],
  "Miner Control": ["miner", "poison"],
  "Hog Cycle": ["hog rider", "cannon", "skeletons"],
};

function confidenceLabel(sampleSize: number): string {
  if (sampleSize < 4) return "low";
  if (sampleSize < 12) return "medium";
  return "high";
}

function deckHash(cards: string[]): string {
  return [...cards]
    .map((card) => card.toLowerCase())
    .sort()
    .join("|");
}

function classifyArchetype(cards: string[]): string {
  const lowered = cards.map((card) => card.toLowerCase());
  for (const [name, keywords] of Object.entries(ARCHETYPE_KEYWORDS)) {
    const matches = keywords.filter((keyword) =>
      lowered.some((card) => card.includes(keyword)),
    ).length;
    if (matches >= 2) return name;
  }
  return "Other";
}

function rollingWinRate(results: number[], windowSize: number): number | null {
  if (results.length < Math.max(2, Math.floor(windowSize / 2))) {
    return null;
  }
  const slice = results.slice(-windowSize);
  return Number(
    (slice.reduce((sum, item) => sum + item, 0) / slice.length).toFixed(3),
  );
}

function linearRegressionSlope(results: number[]): number {
  if (results.length < 5) {
    return 0;
  }
  const xs = results.map((_, index) => index);
  const meanX = xs.reduce((sum, value) => sum + value, 0) / xs.length;
  const meanY = results.reduce((sum, value) => sum + value, 0) / results.length;
  const numerator = xs.reduce(
    (sum, x, index) => sum + (x - meanX) * (results[index] - meanY),
    0,
  );
  const denominator = xs.reduce((sum, x) => sum + (x - meanX) ** 2, 0);
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(6));
}

function trendFromSlope(
  slope: number,
  sampleSize: number,
): Pick<
  PlayerState,
  "trend_direction" | "trend_strength" | "trend_confidence"
> {
  return {
    trend_direction:
      slope > 0.012 ? "improving" : slope < -0.012 ? "declining" : "plateau",
    trend_strength: Number(Math.min(Math.abs(slope) / 0.05, 1).toFixed(3)),
    trend_confidence: confidenceLabel(sampleSize),
  };
}

function tiltAnalysis(battles: NormalizedBattle[]): {
  tilt_win_rate: number | null;
  baseline_win_rate: number;
  tilt_impact: number | null;
  tilt_confidence: string;
} {
  const results: number[] = battles.map((battle) =>
    battle.result === "victory" ? 1 : 0,
  );
  const baseline =
    results.length === 0
      ? 0
      : results.reduce((sum, item) => sum + item, 0) / results.length;
  const tiltResults: number[] = [];

  for (let index = 2; index < results.length; index += 1) {
    if (results[index - 1] === 0 && results[index - 2] === 0) {
      tiltResults.push(results[index]);
    }
  }

  if (tiltResults.length === 0) {
    return {
      tilt_win_rate: null,
      baseline_win_rate: Number(baseline.toFixed(3)),
      tilt_impact: null,
      tilt_confidence: "low",
    };
  }

  const tiltRate =
    tiltResults.reduce((sum, item) => sum + item, 0) / tiltResults.length;
  return {
    tilt_win_rate: Number(tiltRate.toFixed(3)),
    baseline_win_rate: Number(baseline.toFixed(3)),
    tilt_impact: Number((tiltRate - baseline).toFixed(3)),
    tilt_confidence: confidenceLabel(tiltResults.length),
  };
}

function timeSlotLabel(date: Date): string {
  const hour = date.getUTCHours();
  if (hour >= 6 && hour < 12) return "morning";
  if (hour >= 12 && hour < 18) return "afternoon";
  if (hour >= 18) return "evening";
  return "night";
}

function timeSlotAnalysis(
  battles: NormalizedBattle[],
): PlayerState["time_slot_data"] {
  const buckets = new Map<string, number[]>();
  for (const battle of battles) {
    const label = timeSlotLabel(new Date(battle.playedAt));
    const existing = buckets.get(label) ?? [];
    existing.push(battle.result === "victory" ? 1 : 0);
    buckets.set(label, existing);
  }

  return Object.fromEntries(
    [...buckets.entries()]
      .filter(([, results]) => results.length >= 3)
      .map(([slot, results]) => [
        slot,
        {
          games: results.length,
          win_rate: Number(
            (
              results.reduce((sum, item) => sum + item, 0) / results.length
            ).toFixed(3),
          ),
          confidence: confidenceLabel(results.length),
        },
      ]),
  );
}

function deckAnalysis(battles: NormalizedBattle[]): {
  best_deck: DeckStat | null;
  worst_deck: DeckStat | null;
  deck_stability_score: number;
  unique_decks_last_20: number;
} {
  const deckMap = new Map<
    string,
    { cards: string[]; games: number; wins: number }
  >();
  const lastTwentyHashes: string[] = [];

  for (const battle of battles) {
    const hash = deckHash(battle.playerDeck);
    lastTwentyHashes.push(hash);
    const current = deckMap.get(hash) ?? {
      cards: battle.playerDeck,
      games: 0,
      wins: 0,
    };
    current.games += 1;
    if (battle.result === "victory") {
      current.wins += 1;
    }
    deckMap.set(hash, current);
  }

  const stats = [...deckMap.entries()]
    .filter(([, stat]) => stat.games >= 3)
    .map<DeckStat>(([hash, stat]) => ({
      deck_hash: hash,
      cards: stat.cards,
      games: stat.games,
      wins: stat.wins,
      win_rate: Number((stat.wins / stat.games).toFixed(3)),
      confidence: confidenceLabel(stat.games),
    }))
    .sort((left, right) => right.win_rate - left.win_rate);

  const recent = lastTwentyHashes.slice(-20);
  const uniqueRecent = new Set(recent).size;
  const stability =
    recent.length === 0
      ? 0
      : Number((1 - Math.max(uniqueRecent - 1, 0) / recent.length).toFixed(3));

  return {
    best_deck: stats[0] ?? null,
    worst_deck: stats.length > 1 ? stats[stats.length - 1] : null,
    deck_stability_score: stability,
    unique_decks_last_20: uniqueRecent,
  };
}

function matchupAnalysis(battles: NormalizedBattle[]): {
  best_matchups: MatchupStat[];
  worst_matchups: MatchupStat[];
} {
  const matchupMap = new Map<string, { games: number; wins: number }>();
  for (const battle of battles) {
    const archetype = classifyArchetype(battle.opponentDeck);
    const current = matchupMap.get(archetype) ?? { games: 0, wins: 0 };
    current.games += 1;
    if (battle.result === "victory") {
      current.wins += 1;
    }
    matchupMap.set(archetype, current);
  }

  const stats = [...matchupMap.entries()]
    .filter(([, stat]) => stat.games >= 4)
    .map<MatchupStat>(([archetype, stat]) => ({
      archetype,
      games: stat.games,
      wins: stat.wins,
      win_rate: Number((stat.wins / stat.games).toFixed(3)),
      confidence: confidenceLabel(stat.games),
      trend: stat.wins / stat.games >= 0.5 ? "stable" : "declining",
    }))
    .sort((left, right) => right.win_rate - left.win_rate);

  return {
    best_matchups: stats.slice(0, 3),
    worst_matchups: [...stats].reverse().slice(0, 3),
  };
}

function trophyDelta7d(battles: NormalizedBattle[]): number {
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  return battles
    .filter((battle) => new Date(battle.playedAt).getTime() >= cutoff)
    .reduce((sum, battle) => sum + battle.trophyChange, 0);
}

function volatility(results: number[]): {
  win_rate_variance: number;
  result_volatility: string;
} {
  if (results.length === 0) {
    return { win_rate_variance: 0, result_volatility: "stable" };
  }

  const mean = results.reduce((sum, item) => sum + item, 0) / results.length;
  const variance =
    results.reduce((sum, item) => sum + (item - mean) ** 2, 0) / results.length;
  return {
    win_rate_variance: Number(variance.toFixed(4)),
    result_volatility:
      variance < 0.015 ? "stable" : variance < 0.04 ? "moderate" : "volatile",
  };
}

export function buildPlayerState(
  player: { tag?: string; trophies?: number },
  battles: NormalizedBattle[],
): PlayerState {
  const results: number[] = battles.map((battle) =>
    battle.result === "victory" ? 1 : 0,
  );
  const overall =
    results.length === 0
      ? 0
      : results.reduce((sum, item) => sum + item, 0) / results.length;
  const slope = linearRegressionSlope(results);
  const trend = trendFromSlope(slope, results.length);
  const deck = deckAnalysis(battles);
  const matchups = matchupAnalysis(battles);
  const tilt = tiltAnalysis(battles);
  const timeSlots = timeSlotAnalysis(battles);
  const volatilityStats = volatility(results);

  const sortedTimeSlots = Object.entries(timeSlots).sort(
    (left, right) => right[1].win_rate - left[1].win_rate,
  );

  return {
    player_tag: player.tag ?? "",
    trophies: player.trophies ?? 0,
    total_battles: battles.length,
    battles_analyzed: battles.length,
    win_rate_last_10: rollingWinRate(results, 10),
    win_rate_last_20: rollingWinRate(results, 20),
    win_rate_last_50: rollingWinRate(results, 50),
    win_rate_overall: Number(overall.toFixed(3)),
    trend_direction: trend.trend_direction,
    trend_strength: trend.trend_strength,
    trend_confidence: trend.trend_confidence,
    trophy_delta_7d: trophyDelta7d(battles),
    best_deck: deck.best_deck,
    worst_deck: deck.worst_deck,
    deck_stability_score: deck.deck_stability_score,
    unique_decks_last_20: deck.unique_decks_last_20,
    worst_matchups: matchups.worst_matchups,
    best_matchups: matchups.best_matchups,
    tilt_win_rate: tilt.tilt_win_rate,
    baseline_win_rate: tilt.baseline_win_rate,
    tilt_impact: tilt.tilt_impact,
    tilt_confidence: tilt.tilt_confidence,
    best_time_slot: sortedTimeSlots[0]?.[0] ?? null,
    worst_time_slot: sortedTimeSlots.at(-1)?.[0] ?? null,
    time_slot_data: timeSlots,
    win_rate_variance: volatilityStats.win_rate_variance,
    result_volatility: volatilityStats.result_volatility,
  };
}
