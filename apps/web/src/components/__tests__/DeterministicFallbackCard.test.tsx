import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { DeterministicFallbackCard } from '../DeterministicFallbackCard';
import type { Battle, BattleParticipant, Card, PlayerData, PlayerState } from '@/lib/api';

const card: Card = {
  id: 26000000,
  name: 'Knight',
  level: 14,
  maxLevel: 14,
  count: 1,
  iconUrls: {
    medium: 'https://example.com/knight.png',
  },
};

function participant(tag: string, crowns: number): BattleParticipant {
  return {
    tag,
    name: tag,
    startingTrophies: 7000,
    trophyChange: crowns > 1 ? 30 : -30,
    crowns,
    kingTowerHitPoints: 1000,
    princessTowersHitPoints: [],
    cards: [card],
  };
}

function battle(playerCrowns: number, opponentCrowns: number): Battle {
  return {
    type: 'PvP',
    battleTime: '20260101T120000.000Z',
    isLadderTournament: false,
    arena: { id: 54000000, name: 'Legendary Arena' },
    gameMode: { id: 72000006, name: 'Ladder' },
    deckSelection: 'collection',
    team: [participant('#2PP', playerCrowns)],
    opponent: [participant('#AAA', opponentCrowns)],
  };
}

const player: PlayerData = {
  name: 'Coach',
  tag: '#2PP',
  expLevel: 60,
  trophies: 7123,
  bestTrophies: 7300,
  wins: 1200,
  losses: 1000,
  battleCount: 2200,
  threeCrownWins: 300,
  challengeCardsWon: 0,
  challengeMaxWins: 0,
  tournamentCardsWon: 0,
  tournamentBattleCount: 0,
  donations: 0,
  donationsReceived: 0,
  totalDonations: 0,
  warDayWins: 0,
  clanWarTrophies: 0,
  currentDeck: [card, card, card, card, card, card, card, card],
  cards: [card],
  starPoints: 0,
  expPoints: 0,
};

const upsell = {
  reason: 'daily_limit' as const,
  cta: 'Upgrade to Pro for managed premium AI coaching.',
  upgrade_url: '/?upgrade=pro',
};

function playerState(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    player_tag: '#2PP',
    trophies: 7123,
    total_battles: 2200,
    battles_analyzed: 50,
    win_rate_last_10: 0.7,
    win_rate_last_20: 0.62,
    win_rate_last_50: 0.57,
    win_rate_overall: 0.52,
    trend_direction: 'improving',
    trend_strength: 0.78,
    trend_confidence: 'high',
    trophy_delta_7d: 42,
    best_deck: null,
    worst_deck: null,
    deck_stability_score: 0.68,
    unique_decks_last_20: 5,
    worst_matchups: [],
    best_matchups: [],
    tilt_win_rate: null,
    baseline_win_rate: 0.55,
    tilt_impact: null,
    tilt_confidence: 'low',
    best_time_slot: null,
    worst_time_slot: null,
    time_slot_data: {},
    win_rate_variance: 0.08,
    result_volatility: 'medium',
    ...overrides,
  };
}

describe('DeterministicFallbackCard', () => {
  it('clearly labels capped AI output as a non-model deterministic fallback', () => {
    render(
      <DeterministicFallbackCard
        player={player}
        battles={[battle(3, 1), battle(2, 1), battle(0, 2)]}
        upsell={upsell}
      />,
    );

    expect(screen.getByLabelText(/deterministic analytics fallback/i)).toBeInTheDocument();
    expect(screen.getByText(/no model call used/i)).toBeInTheDocument();
    expect(screen.getByText(/today's free ai coaching limit is reached/i)).toBeInTheDocument();
    expect(screen.getByText('67%')).toBeInTheDocument();
    expect(screen.getByText(/2W-1L-0D in recent sample/i)).toBeInTheDocument();
    expect(screen.getByText(/upsell remains available/i)).toBeInTheDocument();
  });

  it('uses server-derived player_state when the response includes deterministic analytics', () => {
    render(
      <DeterministicFallbackCard
        player={player}
        battles={[]}
        upsell={upsell}
        playerState={playerState()}
      />,
    );

    expect(screen.getByText('70%')).toBeInTheDocument();
    expect(screen.getByText(/\+42 trophies over 7 days/i)).toBeInTheDocument();
    expect(screen.getByText(/5 decks \/ last 20/i)).toBeInTheDocument();
  });
});
