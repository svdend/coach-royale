import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { TrackedPlayers } from '../TrackedPlayers';

const mockUseAuth = vi.fn();
const mockGetTrackedPlayers = vi.fn();
const mockRemoveTrackedPlayer = vi.fn();
const mockSyncPlayer = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/lib/api', () => ({
  getTrackedPlayers: () => mockGetTrackedPlayers(),
  removeTrackedPlayer: (id: string) => mockRemoveTrackedPlayer(id),
  syncPlayer: (tag: string) => mockSyncPlayer(tag),
}));

vi.mock('sonner', () => ({
  toast: {
    success: (...args: unknown[]) => mockToastSuccess(...args),
    error: vi.fn(),
  },
}));

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('TrackedPlayers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' } });
  });

  it('renders semantic buttons for saved-player actions', async () => {
    const onSelectPlayer = vi.fn();
    const user = userEvent.setup();

    mockGetTrackedPlayers.mockResolvedValue([
      {
        id: 'tracked-1',
        user_id: 'user-1',
        player_tag: '#2PP',
        player_name: 'Coach Nova',
        is_primary: true,
        nickname: null,
        added_at: '2026-04-22T12:00:00.000Z',
        last_synced_at: null,
      },
    ]);
    mockRemoveTrackedPlayer.mockResolvedValue(undefined);

    renderWithQuery(<TrackedPlayers onSelectPlayer={onSelectPlayer} />);

    const viewButton = await screen.findByRole('button', {
      name: /view primary saved player coach nova/i,
    });

    await user.click(viewButton);
    await user.click(screen.getByRole('button', { name: /remove saved player coach nova/i }));

    expect(onSelectPlayer).toHaveBeenCalledWith('#2PP');
    await waitFor(() => expect(mockRemoveTrackedPlayer).toHaveBeenCalledWith('tracked-1'));
    await waitFor(() => expect(screen.queryByText('Coach Nova')).not.toBeInTheDocument());
    expect(mockToastSuccess).toHaveBeenCalledWith(
      'Removed Coach Nova',
      expect.objectContaining({
        action: expect.objectContaining({ label: 'Undo' }),
        duration: 6000,
      }),
    );
  });

  it('restores a removed player from the toast undo action', async () => {
    const user = userEvent.setup();

    const initialList = [
      {
        id: 'tracked-1',
        user_id: 'user-1',
        player_tag: '#2PP',
        player_name: 'Coach Nova',
        is_primary: true,
        nickname: null,
        added_at: '2026-04-22T12:00:00.000Z',
        last_synced_at: null,
      },
    ];
    const restoredList = [
      {
        id: 'tracked-restored',
        user_id: 'user-1',
        player_tag: '#2PP',
        player_name: 'Coach Nova',
        is_primary: true,
        nickname: null,
        added_at: '2026-04-22T12:00:00.000Z',
        last_synced_at: '2026-04-22T12:05:00.000Z',
      },
    ];
    let fetchCount = 0;
    mockGetTrackedPlayers.mockImplementation(async () => {
      fetchCount += 1;
      if (fetchCount === 1) return initialList;
      return restoredList;
    });
    mockRemoveTrackedPlayer.mockResolvedValue(undefined);
    mockSyncPlayer.mockResolvedValue({ battles_synced: 3 });

    renderWithQuery(<TrackedPlayers onSelectPlayer={vi.fn()} />);

    await user.click(
      await screen.findByRole('button', { name: /remove saved player coach nova/i }),
    );

    const undoAction = mockToastSuccess.mock.calls.find(
      ([message]) => message === 'Removed Coach Nova',
    )?.[1]?.action;

    expect(undoAction).toEqual(expect.objectContaining({ label: 'Undo' }));
    undoAction.onClick();

    await waitFor(() => expect(mockSyncPlayer).toHaveBeenCalledWith('#2PP'));
    expect(await screen.findByText('Coach Nova')).toBeInTheDocument();
  });

  it('announces loading failures', async () => {
    mockGetTrackedPlayers.mockRejectedValue(new Error('network'));

    renderWithQuery(<TrackedPlayers onSelectPlayer={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to load saved players/i);
  });
});
