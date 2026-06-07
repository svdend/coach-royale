import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import { PrivacyCenter } from '../PrivacyCenter';

const mockGetPrivacySettings = vi.fn();
const mockEraseUserData = vi.fn();
const mockSignOut = vi.fn();
const mockClearModelConfig = vi.fn();

vi.mock('@/lib/api', () => ({
  eraseUserData: () => mockEraseUserData(),
  exportUserData: vi.fn(),
  getPrivacySettings: () => mockGetPrivacySettings(),
  updatePrivacySettings: vi.fn(),
}));

vi.mock('@/lib/modelConfig', () => ({
  clearModelConfig: () => mockClearModelConfig(),
}));

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      signOut: () => mockSignOut(),
    },
  },
}));

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

describe('PrivacyCenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockEraseUserData.mockResolvedValue(undefined);
    mockSignOut.mockResolvedValue(undefined);
    mockGetPrivacySettings.mockResolvedValue({
      data_retention_days: 90,
      privacy_policy_version: 'alpha-2026-04',
      privacy_policy_accepted_at: null,
      byok_local_storage_notice_accepted_at: null,
    });
    localStorage.clear();
  });

  it('states the limited retention scope explicitly', async () => {
    const user = userEvent.setup();
    renderWithQuery(<PrivacyCenter userId="user-123" />);

    await user.click(screen.getByRole('button', { name: /privacy center/i }));

    expect(await screen.findByText(/server history retention/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        /retention window below applies only to battle history, stat snapshots, analysis history, and free ai usage counters/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /tracked players, saved deck records, and profile data remain until you erase the account/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /applies only to snapshots, battles, analysis history, and free ai usage counters/i,
      ),
    ).toBeInTheDocument();
  });

  it('erases cloud data, clears local browser state, and signs the user out', async () => {
    const user = userEvent.setup();
    const reloadSpy = vi.fn();
    const originalLocation = window.location;

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: {
        ...originalLocation,
        reload: reloadSpy,
      },
    });

    localStorage.setItem('declaw_last_tag', '2PP');
    localStorage.setItem('coachroyale_usage_2026-04-24', '{"quick_analysis":2}');

    renderWithQuery(<PrivacyCenter userId="user-123" />);

    await user.click(screen.getByRole('button', { name: /privacy center/i }));
    await screen.findByText(/server history retention/i);
    await user.type(screen.getByPlaceholderText('ERASE'), 'ERASE');
    await user.click(screen.getByRole('button', { name: /delete account/i }));

    await waitFor(() => expect(mockEraseUserData).toHaveBeenCalledTimes(1));
    expect(mockSignOut).toHaveBeenCalledTimes(1);
    expect(mockClearModelConfig).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('declaw_last_tag')).toBeNull();
    expect(localStorage.getItem('coachroyale_usage_2026-04-24')).toBeNull();
    expect(reloadSpy).toHaveBeenCalledTimes(1);

    Object.defineProperty(window, 'location', {
      configurable: true,
      value: originalLocation,
    });
  });
});
