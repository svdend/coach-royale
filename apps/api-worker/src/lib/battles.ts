import type { Card, NormalizedBattle, RawBattle } from "../types";
import { normalizeTag } from "./tags";

function parseBattleTime(raw: string | undefined): string {
  if (!raw) {
    return new Date().toISOString();
  }

  const match = raw.match(
    /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.(\d{3}))?Z$/,
  );
  if (!match) {
    return new Date().toISOString();
  }

  const [, year, month, day, hour, minute, second, millis = "000"] = match;
  return new Date(
    `${year}-${month}-${day}T${hour}:${minute}:${second}.${millis}Z`,
  ).toISOString();
}

function cardNames(cards: Card[] | undefined): string[] {
  return (cards ?? [])
    .map((card) => card.name ?? "")
    .filter((name) => name.length > 0);
}

export function normalizeBattle(
  raw: RawBattle,
  playerTag: string,
): NormalizedBattle | null {
  const team = raw.team ?? [];
  const opponent = raw.opponent ?? [];
  if (team.length === 0 || opponent.length === 0) {
    return null;
  }

  const player = team[0];
  const rival = opponent[0];
  const normalizedPlayerTag = normalizeTag(playerTag);

  const playerCrowns = player.crowns ?? 0;
  const rivalCrowns = rival.crowns ?? 0;
  const result =
    playerCrowns > rivalCrowns
      ? "victory"
      : playerCrowns < rivalCrowns
        ? "defeat"
        : "draw";

  const playerDeck = cardNames(player.cards);
  if (playerDeck.length < 4) {
    return null;
  }

  return {
    id: `${normalizedPlayerTag}-${raw.battleTime ?? "unknown"}`
      .replace(/[:.]/g, "")
      .slice(0, 48),
    playerTag: normalizedPlayerTag,
    playerName: player.name ?? "",
    opponentTag: rival.tag ?? "",
    opponentName: rival.name ?? "",
    playerDeck,
    opponentDeck: cardNames(rival.cards),
    result,
    trophyChange:
      player.trophyChange ??
      (result === "victory" ? 30 : result === "defeat" ? -18 : 0),
    playerTrophies: player.startingTrophies ?? 0,
    opponentTrophies: rival.startingTrophies ?? 0,
    playedAt: parseBattleTime(raw.battleTime),
    gameMode: raw.gameMode?.name ?? "",
  };
}

export function battleInsertRecord(
  raw: RawBattle,
  normalizedTag: string,
  userId: string,
): Record<string, unknown> | null {
  const normalized = normalizeBattle(raw, normalizedTag);
  const team = raw.team ?? [];
  const opponent = raw.opponent ?? [];
  if (!normalized || team.length === 0 || opponent.length === 0) {
    return null;
  }

  const player = team[0];
  const rival = opponent[0];

  return {
    user_id: userId,
    player_tag: normalized.playerTag,
    battle_time: normalized.playedAt,
    battle_type: raw.type ?? "PvP",
    game_mode: normalized.gameMode,
    arena_name: raw.arena?.name ?? null,
    result: normalized.result,
    crowns_earned: player.crowns ?? 0,
    crowns_lost: rival.crowns ?? 0,
    trophy_change: normalized.trophyChange,
    starting_trophies: normalized.playerTrophies,
    opponent_tag: normalized.opponentTag,
    opponent_name: normalized.opponentName,
    opponent_starting_trophies: normalized.opponentTrophies,
    deck: player.cards ?? [],
    opponent_deck: rival.cards ?? [],
  };
}
