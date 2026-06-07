import type { Battle, BattleParticipant } from '@/lib/api';

export interface BattleSides {
  player: BattleParticipant;
  opponent: BattleParticipant;
  isOnTeam: boolean;
}

export type BattleResult = 'victory' | 'defeat' | 'draw';

export function normalizePlayerTag(tag: string): string {
  return tag.toUpperCase().replace(/^#/, '');
}

/**
 * Resolve which side of a battle the queried player is on.
 *
 * The Clash Royale API can place the queried player in either
 * `battle.team[]` or `battle.opponent[]` depending on match type
 * (1v1 ladder usually puts them in `team`, but 2v2 / friendly /
 * clan-war / bot matches can swap). Callers must map through
 * this helper rather than assuming `battle.team[0]` is the
 * queried player — see cr-4tk.
 *
 * Returns `null` when either side is empty or the tag isn't
 * found in either side (malformed battle). Callers should skip
 * such records.
 */
export function resolvePlayerSide(battle: Battle, playerTag: string): BattleSides | null {
  const needle = normalizePlayerTag(playerTag);
  if (!needle) return null;

  const isOnTeam = battle.team.some((p) => normalizePlayerTag(p.tag) === needle);
  const isOnOpponent = battle.opponent.some((p) => normalizePlayerTag(p.tag) === needle);
  if (!isOnTeam && !isOnOpponent) return null;

  const teamSide = isOnTeam ? battle.team : battle.opponent;
  const oppSide = isOnTeam ? battle.opponent : battle.team;
  const player = teamSide[0];
  const opponent = oppSide[0];
  if (!player || !opponent) return null;

  return { player, opponent, isOnTeam };
}

export function battleResult(sides: BattleSides): BattleResult {
  if (sides.player.crowns > sides.opponent.crowns) return 'victory';
  if (sides.player.crowns < sides.opponent.crowns) return 'defeat';
  return 'draw';
}
