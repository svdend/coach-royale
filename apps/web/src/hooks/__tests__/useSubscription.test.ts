import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SubscriptionProvider } from '@/auth/SubscriptionProvider';
import { useSubscription } from '../useSubscription';

const { mockGetSubscriptionStatus, mockCreateCheckout, mockUseAuthState } = vi.hoisted(() => ({
  mockGetSubscriptionStatus: vi.fn(),
  mockCreateCheckout: vi.fn(),
  mockUseAuthState: {
    user: null as { id: string; email?: string | null } | null,
    profile: null as { subscription_tier?: 'free' | 'pro' | null } | null,
  },
}));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuthState,
}));

vi.mock('@/lib/api', () => ({
  getSubscriptionStatus: mockGetSubscriptionStatus,
  createCheckout: mockCreateCheckout,
}));

function subscriptionWrapper({ children }: { children: ReactNode }) {
  return createElement(SubscriptionProvider, null, children);
}

describe('useSubscription', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAuthState.user = null;
    mockUseAuthState.profile = null;
  });

  it('stays on free limits for anonymous users without a backend call', () => {
    const { result } = renderHook(() => useSubscription(), { wrapper: subscriptionWrapper });

    expect(result.current.loading).toBe(false);
    expect(result.current.tier).toBe('free');
    expect(result.current.isPro).toBe(false);
    expect(result.current.limits).toEqual({ quick_analysis: 5, deep_analysis: 1 });
    expect(result.current.usageToday).toBeNull();
    expect(result.current.refresh).toEqual(expect.any(Function));
    expect(mockGetSubscriptionStatus).not.toHaveBeenCalled();
  });

  it('hydrates subscription tier from the backend for signed-in non-pro users', async () => {
    mockUseAuthState.user = { id: 'user-1', email: 'user@example.com' };
    mockUseAuthState.profile = { subscription_tier: 'free' };
    mockGetSubscriptionStatus.mockResolvedValue({
      user_id: 'user-1',
      tier: 'free',
      limits: { quick_analysis: 5, deep_analysis: 1 },
      usage_today: { quick_analysis: 2, deep_analysis: 0 },
    });

    const { result } = renderHook(() => useSubscription(), { wrapper: subscriptionWrapper });

    expect(result.current.loading).toBe(true);
    expect(result.current.tier).toBe('free');

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tier).toBe('free');
    expect(result.current.isPro).toBe(false);
    expect(result.current.limits).toEqual({ quick_analysis: 5, deep_analysis: 1 });
    expect(result.current.usageToday).toEqual({ quick_analysis: 2, deep_analysis: 0 });
    expect(mockGetSubscriptionStatus).toHaveBeenCalledWith('user-1');
  });

  it('trusts the profile for pro users and skips backend startup fetches', () => {
    mockUseAuthState.user = { id: 'user-2', email: 'pro@example.com' };
    mockUseAuthState.profile = { subscription_tier: 'pro' };

    const { result } = renderHook(() => useSubscription(), { wrapper: subscriptionWrapper });

    expect(result.current.loading).toBe(false);
    expect(result.current.isPro).toBe(true);
    expect(result.current.limits).toEqual({ quick_analysis: 999, deep_analysis: 999 });
    expect(result.current.usageToday).toEqual({ quick_analysis: 0, deep_analysis: 0 });
    expect(mockGetSubscriptionStatus).not.toHaveBeenCalled();
  });

  it('falls back to free limits when the backend check fails', async () => {
    mockUseAuthState.user = { id: 'user-3', email: 'fallback@example.com' };
    mockUseAuthState.profile = { subscription_tier: 'free' };
    mockGetSubscriptionStatus.mockRejectedValue(new Error('network down'));

    const { result } = renderHook(() => useSubscription(), { wrapper: subscriptionWrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.tier).toBe('free');
    expect(result.current.isPro).toBe(false);
    expect(result.current.limits).toEqual({ quick_analysis: 5, deep_analysis: 1 });
    expect(result.current.usageToday).toEqual({ quick_analysis: 0, deep_analysis: 0 });
  });

  it('refresh refetches subscription status', async () => {
    mockUseAuthState.user = { id: 'user-4', email: 'r@example.com' };
    mockUseAuthState.profile = { subscription_tier: 'free' };
    mockGetSubscriptionStatus.mockResolvedValue({
      user_id: 'user-4',
      tier: 'free',
      limits: { quick_analysis: 5, deep_analysis: 1 },
      usage_today: { quick_analysis: 1, deep_analysis: 0 },
    });

    const { result } = renderHook(() => useSubscription(), { wrapper: subscriptionWrapper });
    await waitFor(() => expect(result.current.usageToday?.quick_analysis).toBe(1));

    mockGetSubscriptionStatus.mockResolvedValueOnce({
      user_id: 'user-4',
      tier: 'free',
      limits: { quick_analysis: 5, deep_analysis: 1 },
      usage_today: { quick_analysis: 2, deep_analysis: 0 },
    });
    await result.current.refresh();
    await waitFor(() => expect(result.current.usageToday?.quick_analysis).toBe(2));
    expect(mockGetSubscriptionStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('throws when used outside SubscriptionProvider', () => {
    expect(() => {
      renderHook(() => useSubscription());
    }).toThrow(/useSubscription must be used within a SubscriptionProvider/);
  });
});
