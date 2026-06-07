import { beforeEach, describe, expect, it, vi } from 'vitest';

const { mockGetSession } = vi.hoisted(() => ({
  mockGetSession: vi.fn<() => Promise<{ data: { session: { access_token: string } | null } }>>(
    async () => ({ data: { session: null } }),
  ),
}));

vi.mock('../supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
    },
  },
}));

import {
  createCheckout,
  fetchBattleLog,
  fetchCustomModelAnalysis,
  fetchPlayer,
  fetchQuickAnalysis,
  getSubscriptionStatus,
  getTrackedPlayers,
} from '../api';

// We need to access normalizeTag and encodeTag which are not exported.
// We test them indirectly through the fetch-based functions, but we can
// also import the module and test the URL construction.

// In jsdom (vitest), window.location.hostname is 'localhost',
// so api.ts resolves to the local dev URL.
const API_BASE = 'http://localhost:8787/api';

// Mock global fetch
const mockFetch = vi.fn();
globalThis.fetch = mockFetch;

function mockOkResponse(data: unknown): Response {
  const body = JSON.stringify(data);
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(body),
  } as Response;
}

function mockErrorResponse(status: number): Response {
  const body = JSON.stringify({});
  return {
    ok: false,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(body),
  } as Response;
}

function makePlayerData() {
  return {
    name: 'Player1',
    tag: '#2PP',
    expLevel: 60,
    trophies: 5000,
    bestTrophies: 5200,
    wins: 100,
    losses: 80,
    battleCount: 200,
    threeCrownWins: 15,
    challengeCardsWon: 0,
    challengeMaxWins: 0,
    tournamentCardsWon: 0,
    tournamentBattleCount: 0,
    donations: 0,
    donationsReceived: 0,
    totalDonations: 0,
    warDayWins: 0,
    clanWarTrophies: 0,
    currentDeck: [],
    cards: [],
    starPoints: 0,
    expPoints: 0,
  };
}

function makeBattle() {
  return {
    type: 'ladder',
    battleTime: '2024-01-01T00:00:00.000Z',
    isLadderTournament: false,
    arena: {
      id: 1,
      name: 'Arena 1',
    },
    gameMode: {
      id: 72000006,
      name: 'Ladder',
    },
    deckSelection: 'collection',
    team: [
      {
        tag: '#2PP',
        name: 'Player1',
        startingTrophies: 5000,
        crowns: 3,
        kingTowerHitPoints: 0,
        princessTowersHitPoints: [],
        cards: [],
      },
    ],
    opponent: [
      {
        tag: '#ABC',
        name: 'Opponent',
        startingTrophies: 5000,
        crowns: 0,
        kingTowerHitPoints: 0,
        princessTowersHitPoints: [],
        cards: [],
      },
    ],
  };
}

describe('api', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue({ data: { session: null } });
  });

  describe('normalizeTag (tested via fetch URL)', () => {
    it('adds # prefix and uppercases via fetchPlayer URL', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse(makePlayerData()));
      await fetchPlayer('abc');
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      // normalizeTag('abc') => '#ABC', encodeURIComponent('#ABC') => '%23ABC'
      expect(calledUrl).toBe(`${API_BASE}/player/%23ABC`);
    });

    it('handles already-prefixed tags', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse(makePlayerData()));
      await fetchPlayer('#2PP');
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toBe(`${API_BASE}/player/%232PP`);
    });

    it('uppercases tags', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse(makePlayerData()));
      await fetchPlayer('2pp');
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toBe(`${API_BASE}/player/%232PP`);
    });

    it('URL-encodes the # in the tag', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse(makePlayerData()));
      await fetchPlayer('GRJCUV');
      const calledUrl = mockFetch.mock.calls[0][0] as string;
      expect(calledUrl).toContain('%23');
      expect(calledUrl).toBe(`${API_BASE}/player/%23GRJCUV`);
    });
  });

  describe('fetchPlayer', () => {
    it('builds correct URL', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse(makePlayerData()));
      await fetchPlayer('2PP');
      expect(mockFetch).toHaveBeenCalledWith(`${API_BASE}/player/%232PP`);
    });

    it('returns player data on success', async () => {
      const playerData = makePlayerData();
      mockFetch.mockResolvedValueOnce(mockOkResponse(playerData));
      const result = await fetchPlayer('2PP');
      expect(result).toEqual(playerData);
    });

    it('rejects invalid player payloads', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse({ name: 'Player1' }));
      await expect(fetchPlayer('2PP')).rejects.toThrow(
        'Player not found: invalid response payload',
      );
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(404));
      await expect(fetchPlayer('INVALID')).rejects.toThrow('Player not found (404)');
    });

    it('throws nested Worker error envelope message on non-ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              error: {
                code: 'provider_unavailable',
                message: 'coaching_unavailable',
              },
              request_id: 'req-test-1',
            }),
          ),
      } as Response);
      await expect(fetchPlayer('2PP')).rejects.toThrow('coaching_unavailable');
    });

    it('throws legacy string error body on non-ok', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () => Promise.resolve(JSON.stringify({ error: 'Unauthorized' })),
      } as Response);
      await expect(fetchPlayer('2PP')).rejects.toThrow('Unauthorized');
    });
  });

  describe('fetchBattleLog', () => {
    it('builds correct URL', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse([makeBattle()]));
      await fetchBattleLog('2PP');
      expect(mockFetch).toHaveBeenCalledWith(`${API_BASE}/player/%232PP/battles`);
    });

    it('returns battle array on success', async () => {
      const battles = [makeBattle()];
      mockFetch.mockResolvedValueOnce(mockOkResponse(battles));
      const result = await fetchBattleLog('2PP');
      expect(result).toEqual(battles);
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(500));
      await expect(fetchBattleLog('2PP')).rejects.toThrow('Failed to fetch battles (500)');
    });

    it('rejects invalid battle payloads', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse([{ type: 'ladder' }]));
      await expect(fetchBattleLog('2PP')).rejects.toThrow(
        'Failed to fetch battles: invalid response payload',
      );
    });
  });

  describe('createCheckout', () => {
    it('sends correct body', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse({ checkout_url: 'https://pay.example.com' }));
      await createCheckout('user@example.com', 'user-123');
      expect(mockFetch).toHaveBeenCalledWith(`${API_BASE}/payments/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_email: 'user@example.com', user_id: 'user-123' }),
      });
    });

    it('returns checkout URL on success', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse({ checkout_url: 'https://pay.example.com' }));
      const result = await createCheckout('user@example.com', 'user-123');
      expect(result.checkout_url).toBe('https://pay.example.com');
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(402));
      await expect(createCheckout('a@b.com', 'x')).rejects.toThrow('Checkout failed (402)');
    });
  });

  describe('getSubscriptionStatus', () => {
    it('builds correct URL', async () => {
      mockFetch.mockResolvedValueOnce(
        mockOkResponse({
          user_id: 'u1',
          tier: 'free',
          limits: { quick_analysis: 5, deep_analysis: 1 },
          usage_today: { quick_analysis: 0, deep_analysis: 0 },
        }),
      );
      await getSubscriptionStatus('u1');
      expect(mockFetch).toHaveBeenCalledWith(`${API_BASE}/payments/subscription/u1`);
    });

    it('returns subscription data on success', async () => {
      const subData = {
        user_id: 'u1',
        tier: 'pro' as const,
        limits: { quick_analysis: 999, deep_analysis: 999 },
        usage_today: { quick_analysis: 3, deep_analysis: 0 },
      };
      mockFetch.mockResolvedValueOnce(mockOkResponse(subData));
      const result = await getSubscriptionStatus('u1');
      expect(result.tier).toBe('pro');
      expect(result.limits.quick_analysis).toBe(999);
      expect(result.usage_today).toEqual({ quick_analysis: 3, deep_analysis: 0 });
    });

    it('throws on non-ok response', async () => {
      mockFetch.mockResolvedValueOnce(mockErrorResponse(500));
      await expect(getSubscriptionStatus('u1')).rejects.toThrow('Subscription check failed (500)');
    });
  });

  describe('fetchQuickAnalysis', () => {
    it('parses optional free-lane upsell metadata', async () => {
      mockFetch.mockResolvedValueOnce(
        mockOkResponse({
          success: false,
          result: { response: '' },
          text: null,
          upsell: {
            reason: 'daily_limit',
            cta: 'Upgrade to Pro for unlimited coaching.',
            upgrade_url: '/?upgrade=pro',
          },
        }),
      );

      const result = await fetchQuickAnalysis(
        'Give quick stats',
        { name: 'Coach', tag: '#2PP' },
        'quick_stats',
        { playerTag: '#2PP' },
      );

      expect(result.upsell?.reason).toBe('daily_limit');
      expect(result.result.response).toBe('');
    });
  });

  describe('getTrackedPlayers', () => {
    it('adds the bearer token when a session exists', async () => {
      mockGetSession.mockResolvedValue({
        data: { session: { access_token: 'token-123' } },
      });
      mockFetch.mockResolvedValueOnce(
        mockOkResponse([
          {
            id: 'tracked-1',
            user_id: 'user-1',
            player_tag: '#2PP',
            player_name: 'Player1',
            is_primary: true,
            nickname: null,
            added_at: '2026-04-23T00:00:00.000Z',
            last_synced_at: null,
          },
        ]),
      );

      await getTrackedPlayers();

      expect(mockFetch).toHaveBeenCalledWith(`${API_BASE}/tracked-players`, {
        headers: new Headers({ Authorization: 'Bearer token-123' }),
      });
    });

    it('rejects invalid tracked-player payloads', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse([{ id: 'tracked-1' }]));
      await expect(getTrackedPlayers()).rejects.toThrow(
        'Failed to load tracked players: invalid response payload',
      );
    });
  });

  describe('fetchCustomModelAnalysis', () => {
    it('calls the normalized provider endpoint and omits empty auth headers', async () => {
      const controller = new AbortController();
      mockFetch.mockResolvedValueOnce(
        mockOkResponse({
          choices: [
            {
              message: {
                content: 'Coach response',
              },
            },
          ],
        }),
      );

      const result = await fetchCustomModelAnalysis(
        {
          baseUrl: 'http://localhost:11434/v1/',
          apiKey: '',
          model: 'qwen2.5:14b',
        },
        { tag: '#2PP' },
        [],
        controller.signal,
      );

      expect(result).toBe('Coach response');
      expect(mockFetch).toHaveBeenCalledWith('http://localhost:11434/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: expect.any(String),
        signal: controller.signal,
      });
    });

    it('surfaces provider error messages cleanly', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: () =>
          Promise.resolve(
            JSON.stringify({
              error: {
                message: 'Invalid API key',
              },
            }),
          ),
      } as Response);

      await expect(
        fetchCustomModelAnalysis(
          {
            baseUrl: 'https://openrouter.ai/api/v1',
            apiKey: 'sk-test',
            model: 'qwen/qwen3',
          },
          { tag: '#2PP' },
          [],
        ),
      ).rejects.toThrow('Model API error 401: Invalid API key');
    });

    it('rejects invalid custom model payloads', async () => {
      mockFetch.mockResolvedValueOnce(mockOkResponse({ choices: [] }));
      await expect(
        fetchCustomModelAnalysis(
          {
            baseUrl: 'https://openrouter.ai/api/v1',
            apiKey: 'sk-test',
            model: 'qwen/qwen3',
          },
          { tag: '#2PP' },
          [],
        ),
      ).rejects.toThrow('Custom model analysis failed: invalid response payload');
    });
  });
});
