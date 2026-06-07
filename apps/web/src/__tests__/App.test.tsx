import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authState: {
    user: null,
    profile: null,
    session: null,
    loading: true,
    signInWithDiscord: vi.fn(),
    signInWithGoogle: vi.fn(),
    signOut: vi.fn(),
    refreshProfile: vi.fn().mockResolvedValue(undefined),
  },
  subscriptionRefresh: vi.fn().mockResolvedValue(undefined),
  fetchPlayer: vi.fn(),
  fetchBattleLog: vi.fn(),
  syncPlayer: vi.fn(),
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mocks.authState,
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => ({
    tier: 'free',
    isPro: false,
    loading: false,
    limits: { quick_analysis: 5, deep_analysis: 1 },
    usageToday: null,
    refresh: mocks.subscriptionRefresh,
    upgrade: vi.fn(),
  }),
}));

vi.mock('@/lib/api', () => ({
  fetchPlayer: mocks.fetchPlayer,
  fetchBattleLog: mocks.fetchBattleLog,
  syncPlayer: mocks.syncPlayer,
}));

vi.mock('@/components/SearchBar', () => ({
  SearchBar: ({ onSearch }: { onSearch: (tag: string) => void }) => (
    <div data-testid="search-bar">
      <button onClick={() => onSearch('2PP')}>search saved</button>
      <button onClick={() => onSearch('FIRST')}>search first</button>
      <button onClick={() => onSearch('SECOND')}>search second</button>
    </div>
  ),
}));

vi.mock('@/components/PlayerHeader', () => ({
  PlayerHeader: ({ player }: { player: { name: string } }) => <div>{player.name}</div>,
}));

vi.mock('@/components/StatsPanel', () => ({
  StatsPanel: () => <div>stats panel</div>,
}));

vi.mock('@/components/BattleLog', () => ({
  BattleLog: () => <div>battle log</div>,
}));

vi.mock('@/components/AuthButton', () => ({
  AuthButton: () => <div>auth button</div>,
}));

vi.mock('@/components/LoadingState', () => ({
  PlayerHeaderSkeleton: () => <div>player header skeleton</div>,
  StatsPanelSkeleton: () => <div>stats panel skeleton</div>,
  BattleLogSkeleton: () => <div>battle log skeleton</div>,
}));

vi.mock('@/components/UpgradeButton', () => ({
  UpgradeButton: () => <div>upgrade button</div>,
}));

vi.mock('@/components/ui/tabs', () => ({
  Tabs: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsList: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  TabsTrigger: ({ children }: { children: ReactNode }) => <button>{children}</button>,
  TabsContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

import App from '../App';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe('App bootstrap search', () => {
  beforeEach(() => {
    mocks.authState = {
      user: null,
      profile: null,
      session: null,
      loading: true,
      signInWithDiscord: vi.fn(),
      signInWithGoogle: vi.fn(),
      signOut: vi.fn(),
      refreshProfile: vi.fn().mockResolvedValue(undefined),
    };
    mocks.fetchPlayer.mockResolvedValue({
      name: 'Coach',
      tag: '#2PP',
    });
    mocks.fetchBattleLog.mockResolvedValue([]);
    mocks.syncPlayer.mockResolvedValue(undefined);
    localStorage.clear();
    localStorage.setItem('declaw_last_tag', '2PP');
  });

  it('waits for auth hydration before auto-searching the saved tag', async () => {
    const { rerender } = render(<App />);

    expect(mocks.fetchPlayer).not.toHaveBeenCalled();

    mocks.authState = {
      ...mocks.authState,
      loading: false,
    };

    rerender(<App />);

    await waitFor(() =>
      expect(mocks.fetchPlayer).toHaveBeenCalledWith('2PP', expect.any(AbortSignal)),
    );

    rerender(<App />);
    expect(mocks.fetchPlayer).toHaveBeenCalledTimes(1);
  });

  it('ignores stale results from a superseded search', async () => {
    localStorage.clear();
    mocks.authState = {
      ...mocks.authState,
      loading: false,
    };

    const firstSearch = deferred<{ name: string; tag: string }>();
    const secondSearch = deferred<{ name: string; tag: string }>();
    mocks.fetchPlayer.mockImplementation((tag: string) => {
      if (tag === 'FIRST') {
        return firstSearch.promise;
      }
      if (tag === 'SECOND') {
        return secondSearch.promise;
      }
      return Promise.resolve({ name: 'Coach', tag: '#2PP' });
    });

    render(<App />);

    fireEvent.click(screen.getByText('search first'));
    fireEvent.click(screen.getByText('search second'));

    firstSearch.resolve({ name: 'First Player', tag: '#FIRST' });
    await Promise.resolve();

    expect(screen.queryByText('First Player')).not.toBeInTheDocument();

    secondSearch.resolve({ name: 'Second Player', tag: '#SECOND' });

    await waitFor(() => expect(screen.getAllByText('Second Player').length).toBeGreaterThan(0));
    expect(screen.queryByText('First Player')).not.toBeInTheDocument();
  });
});
