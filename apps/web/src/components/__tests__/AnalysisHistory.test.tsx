import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { AnalysisHistory } from '../AnalysisHistory';

const mockUseAuth = vi.fn();
const mockGetAnalysisHistory = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/lib/api', () => ({
  getAnalysisHistory: (...args: unknown[]) => mockGetAnalysisHistory(...args),
}));

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('AnalysisHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuth.mockReturnValue({ user: { id: 'user-1' } });
  });

  it('uses buttons with expand/collapse state for history entries', async () => {
    const user = userEvent.setup();

    mockGetAnalysisHistory.mockResolvedValue([
      {
        id: 'analysis-1',
        user_id: 'user-1',
        player_tag: '#2PP',
        analysis_type: 'quick_stats',
        prompt: null,
        result: 'Quick summary for the player.',
        model: 'gpt-5',
        created_at: '2026-04-22T12:00:00.000Z',
      },
    ]);

    renderWithQuery(<AnalysisHistory playerTag="#2PP" />);

    const toggle = await screen.findByRole('button', { name: /quick stats/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('region')).toHaveTextContent(/quick summary for the player/i);
  });

  it('announces loading failures', async () => {
    mockGetAnalysisHistory.mockRejectedValue(new Error('network'));

    renderWithQuery(<AnalysisHistory playerTag="#2PP" />);

    expect(await screen.findByRole('alert')).toHaveTextContent(/failed to load past analyses/i);
  });
});
