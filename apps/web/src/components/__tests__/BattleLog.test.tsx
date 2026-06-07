import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BattleLog } from '../BattleLog';
import type { Battle, BattleParticipant } from '@/lib/api';

function participant(tag: string, name: string, crowns: number): BattleParticipant {
  return {
    tag,
    name,
    startingTrophies: 6000,
    crowns,
    kingTowerHitPoints: 4000,
    princessTowersHitPoints: [3000, 3000],
    cards: [],
  };
}

function baseBattle(overrides: Partial<Battle> = {}): Battle {
  const me = participant('#ME', 'Me', 2);
  const them = participant('#THEM', 'Them', 1);
  return {
    type: 'PvP',
    battleTime: '20260101T120000.000Z',
    isLadderTournament: false,
    arena: { id: 54000000, name: 'Arena' },
    gameMode: { id: 72000006, name: 'Ladder' },
    deckSelection: 'collection',
    team: [me],
    opponent: [them],
    ...overrides,
  };
}

describe('BattleLog', () => {
  it('renders game mode name when present', () => {
    render(<BattleLog battles={[baseBattle()]} playerTag="#ME" />);
    expect(screen.getByText('Ladder')).toBeInTheDocument();
  });

  it('does not crash when gameMode is null (cr-dqx)', () => {
    const b = baseBattle({ gameMode: null });
    render(<BattleLog battles={[b]} playerTag="#ME" />);
    expect(screen.getByText('Unknown mode')).toBeInTheDocument();
    expect(screen.getByText(/vs/)).toBeInTheDocument();
  });

  it('shows a neutral trophy badge when trophy change is zero', () => {
    const b = baseBattle({
      team: [
        {
          ...participant('#ME', 'Me', 1),
          trophyChange: 0,
        },
      ],
      opponent: [participant('#THEM', 'Them', 1)],
    });

    render(<BattleLog battles={[b]} playerTag="#ME" />);

    const badge = screen.getByText('0');
    expect(badge).toBeInTheDocument();
    expect(badge).toHaveClass('text-muted-foreground');
  });
});
