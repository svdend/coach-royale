import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { PlayerHeader } from '../PlayerHeader';
import type { Card, PlayerData } from '@/lib/api';

function card(index: number): Card {
  return {
    id: index,
    name: `Card ${index}`,
    level: 14,
    maxLevel: 14,
    count: 1,
    iconUrls: {
      medium: `https://example.com/card-${index}.png`,
    },
  };
}

function player(currentDeck: Card[]): PlayerData {
  return {
    name: 'Coach',
    tag: '#COACH',
    expLevel: 50,
    trophies: 7500,
    bestTrophies: 7600,
    wins: 100,
    losses: 50,
    battleCount: 150,
    threeCrownWins: 25,
    challengeCardsWon: 0,
    challengeMaxWins: 0,
    tournamentCardsWon: 0,
    tournamentBattleCount: 0,
    donations: 0,
    donationsReceived: 0,
    totalDonations: 0,
    warDayWins: 0,
    clanWarTrophies: 0,
    currentDeck,
    cards: currentDeck,
    starPoints: 0,
    expPoints: 0,
  };
}

describe('PlayerHeader', () => {
  it('loads the first 8 current deck images with high priority', () => {
    const currentDeck = Array.from({ length: 8 }, (_, index) => card(index + 1));

    render(<PlayerHeader player={player(currentDeck)} />);

    const deckImages = currentDeck
      .slice(0, 8)
      .map((deckCard) => screen.getByAltText(deckCard.name));

    expect(deckImages).toHaveLength(8);
    deckImages.forEach((image) => {
      expect(image).toHaveAttribute('fetchpriority', 'high');
      expect(image).toHaveAttribute('loading', 'eager');
      expect(image).toHaveAttribute('decoding', 'async');
      expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
    });
  });
});
