import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PlayerAnalyticsPanel } from '../PlayerAnalytics';
import type { PlayerState } from '@/lib/api';

const mockFetchPlayerAnalytics = vi.fn();

vi.mock('@/lib/api', () => ({
  fetchPlayerAnalytics: (tag: string) => mockFetchPlayerAnalytics(tag),
}));

function buildState(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    player_tag: '#2PP',
    trophies: 7123,
    total_battles: 4200,
    battles_analyzed: 50,
    win_rate_last_10: 0.7,
    win_rate_last_20: 0.62,
    win_rate_last_50: 0.57,
    win_rate_overall: 0.52,
    trend_direction: 'improving',
    trend_strength: 0.78,
    trend_confidence: 'high',
    trophy_delta_7d: 42,
    best_deck: {
      deck_hash: 'best-deck',
      cards: ['Knight', 'Archers', 'Hog Rider', 'Cannon'],
      games: 18,
      wins: 12,
      win_rate: 0.67,
      confidence: 'high',
    },
    worst_deck: {
      deck_hash: 'worst-deck',
      cards: ['Giant', 'Witch', 'Minions', 'Arrows'],
      games: 10,
      wins: 3,
      win_rate: 0.3,
      confidence: 'medium',
    },
    deck_stability_score: 0.68,
    unique_decks_last_20: 4,
    worst_matchups: [
      {
        archetype: 'LavaLoon',
        games: 8,
        wins: 2,
        win_rate: 0.25,
        confidence: 'medium',
        trend: 'cold',
      },
    ],
    best_matchups: [
      {
        archetype: 'Log Bait',
        games: 9,
        wins: 7,
        win_rate: 0.78,
        confidence: 'high',
        trend: 'hot',
      },
    ],
    tilt_win_rate: 0.44,
    baseline_win_rate: 0.55,
    tilt_impact: -0.11,
    tilt_confidence: 'medium',
    best_time_slot: 'evening',
    worst_time_slot: 'morning',
    time_slot_data: {
      morning: { games: 10, win_rate: 0.45, confidence: 'medium' },
      evening: { games: 14, win_rate: 0.64, confidence: 'high' },
    },
    win_rate_variance: 0.08,
    result_volatility: 'medium',
    ...overrides,
  };
}

describe('PlayerAnalyticsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders a momentum chart with sample-based insights after loading analytics', async () => {
    const user = userEvent.setup();
    mockFetchPlayerAnalytics.mockResolvedValue({ player_state: buildState() });

    render(<PlayerAnalyticsPanel playerTag="#2PP" />);

    await user.click(screen.getByRole('button', { name: /load analytics/i }));

    expect(mockFetchPlayerAnalytics).toHaveBeenCalledWith('#2PP');
    expect(await screen.findByRole('img', { name: /win rate trend chart/i })).toBeInTheDocument();
    expect(screen.getByText(/momentum snapshot/i)).toBeInTheDocument();
    expect(screen.getByText('+18 pts')).toBeInTheDocument();
    expect(screen.getByText(/peak last 10:/i)).toBeInTheDocument();
  });

  it('keeps the chart visible when recent windows are missing', async () => {
    const user = userEvent.setup();
    mockFetchPlayerAnalytics.mockResolvedValue({
      player_state: buildState({
        win_rate_last_10: null,
        win_rate_last_20: null,
        win_rate_last_50: 0.51,
        trend_direction: 'plateau',
      }),
    });

    render(<PlayerAnalyticsPanel playerTag="#SPARSE" />);

    await user.click(screen.getByRole('button', { name: /load analytics/i }));

    expect(mockFetchPlayerAnalytics).toHaveBeenCalledWith('#SPARSE');
    expect(await screen.findByRole('img', { name: /win rate trend chart/i })).toBeInTheDocument();
    expect(screen.getByText(/current baseline/i)).toBeInTheDocument();
    expect(screen.getByText(/last 10 sample unavailable/i)).toBeInTheDocument();
  });
});
