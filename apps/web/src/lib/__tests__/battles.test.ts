import { describe, it, expect } from 'vitest';
import { resolvePlayerSide, battleResult, normalizePlayerTag } from '../battles';
import type { Battle, BattleParticipant } from '../api';

function participant(
  tag: string,
  name: string,
  crowns: number,
  extras: Partial<BattleParticipant> = {},
): BattleParticipant {
  return {
    tag,
    name,
    startingTrophies: 6000,
    crowns,
    kingTowerHitPoints: 0,
    princessTowersHitPoints: [],
    cards: [],
    ...extras,
  };
}

function battle(
  team: BattleParticipant[],
  opponent: BattleParticipant[],
  extras: Partial<Battle> = {},
): Battle {
  return {
    type: 'PvP',
    battleTime: '20260101T120000.000Z',
    isLadderTournament: false,
    arena: { id: 54000000, name: 'Arena' },
    gameMode: { id: 72000006, name: 'Ladder' },
    deckSelection: 'collection',
    team,
    opponent,
    ...extras,
  };
}

describe('normalizePlayerTag', () => {
  it('uppercases and strips a single leading #', () => {
    expect(normalizePlayerTag('#abc')).toBe('ABC');
    expect(normalizePlayerTag('abc')).toBe('ABC');
    expect(normalizePlayerTag('ABC')).toBe('ABC');
  });

  it('returns empty for empty input', () => {
    expect(normalizePlayerTag('')).toBe('');
  });
});

describe('resolvePlayerSide', () => {
  const me = participant('#ME123', 'Me', 2);
  const them = participant('#THEM', 'Opponent', 1);

  it('1v1, player is in team[] → isOnTeam=true and sides are as-is', () => {
    const b = battle([me], [them]);
    const sides = resolvePlayerSide(b, '#ME123');
    expect(sides).not.toBeNull();
    expect(sides!.isOnTeam).toBe(true);
    expect(sides!.player.tag).toBe('#ME123');
    expect(sides!.opponent.tag).toBe('#THEM');
  });

  it('1v1, player is in opponent[] → isOnTeam=false and sides are swapped', () => {
    const b = battle([them], [me]);
    const sides = resolvePlayerSide(b, '#ME123');
    expect(sides).not.toBeNull();
    expect(sides!.isOnTeam).toBe(false);
    expect(sides!.player.tag).toBe('#ME123');
    expect(sides!.opponent.tag).toBe('#THEM');
  });

  it('2v2, player is second in team[] → still resolves to the player', () => {
    const mate = participant('#MATE', 'Mate', 2);
    const opp2 = participant('#OPP2', 'Opp2', 1);
    const b = battle([mate, me], [them, opp2]);
    const sides = resolvePlayerSide(b, '#ME123');
    expect(sides).not.toBeNull();
    expect(sides!.isOnTeam).toBe(true);
    // First listed teammate is used as `player` for consistency
    // with prior rendering; document the choice.
    expect(sides!.player.tag).toBe('#MATE');
    expect(sides!.opponent.tag).toBe('#THEM');
  });

  it('2v2, player is second in opponent[] → sides swap correctly', () => {
    const mate = participant('#MATE', 'Mate', 2);
    const opp2 = participant('#OPP2', 'Opp2', 1);
    const b = battle([them, opp2], [mate, me]);
    const sides = resolvePlayerSide(b, '#ME123');
    expect(sides).not.toBeNull();
    expect(sides!.isOnTeam).toBe(false);
    expect(sides!.player.tag).toBe('#MATE');
    expect(sides!.opponent.tag).toBe('#THEM');
  });

  it('tag casing does not matter', () => {
    const b = battle([me], [them]);
    expect(resolvePlayerSide(b, 'me123')).not.toBeNull();
    expect(resolvePlayerSide(b, '#me123')).not.toBeNull();
    expect(resolvePlayerSide(b, '#ME123')).not.toBeNull();
  });

  it('returns null for empty tag', () => {
    const b = battle([me], [them]);
    expect(resolvePlayerSide(b, '')).toBeNull();
    expect(resolvePlayerSide(b, '#')).toBeNull();
  });

  it('returns null when player is not in either side', () => {
    const b = battle([them], [participant('#OTHER', 'Other', 0)]);
    expect(resolvePlayerSide(b, '#ME123')).toBeNull();
  });

  it('returns null when a side is empty', () => {
    expect(resolvePlayerSide(battle([me], []), '#ME123')).toBeNull();
    expect(resolvePlayerSide(battle([], [me]), '#ME123')).toBeNull();
  });
});

describe('battleResult', () => {
  const me = participant('#ME', 'Me', 0);
  const them = participant('#THEM', 'Them', 0);

  it('victory when player crowns > opponent', () => {
    const sides = resolvePlayerSide(
      battle([{ ...me, crowns: 3 }], [{ ...them, crowns: 1 }]),
      '#ME',
    )!;
    expect(battleResult(sides)).toBe('victory');
  });

  it('defeat when player crowns < opponent', () => {
    const sides = resolvePlayerSide(
      battle([{ ...me, crowns: 0 }], [{ ...them, crowns: 2 }]),
      '#ME',
    )!;
    expect(battleResult(sides)).toBe('defeat');
  });

  it('draw when equal', () => {
    const sides = resolvePlayerSide(
      battle([{ ...me, crowns: 2 }], [{ ...them, crowns: 2 }]),
      '#ME',
    )!;
    expect(battleResult(sides)).toBe('draw');
  });

  it('reports victory from the player POV even when they are in opponent[]', () => {
    // Player is in battle.opponent[] with more crowns; naive
    // consumers that read team[0] would have reported defeat.
    const sides = resolvePlayerSide(
      battle([{ ...them, crowns: 0 }], [{ ...me, crowns: 3 }]),
      '#ME',
    )!;
    expect(sides.isOnTeam).toBe(false);
    expect(battleResult(sides)).toBe('victory');
  });
});
