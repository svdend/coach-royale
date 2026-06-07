import { createElement, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthProvider } from '@/auth/AuthProvider';
import { useAuth } from '../useAuth';

type MockSession = {
  access_token?: string;
  user?: { id: string; email?: string | null } | null;
} | null;

const {
  mockGetSession,
  mockOnAuthStateChange,
  mockSignInWithOAuth,
  mockSignOut,
  mockGetProfile,
  mockGetAuthRedirectUrl,
  mockSubscriptionUnsubscribe,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn<() => Promise<{ data: { session: MockSession } }>>(),
  mockOnAuthStateChange: vi.fn(),
  mockSignInWithOAuth: vi.fn(),
  mockSignOut: vi.fn(),
  mockGetProfile: vi.fn(),
  mockGetAuthRedirectUrl: vi.fn(),
  mockSubscriptionUnsubscribe: vi.fn(),
}));

let authChangeHandler: ((event: string, session: MockSession) => void) | null = null;

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: mockGetSession,
      onAuthStateChange: mockOnAuthStateChange,
      signInWithOAuth: mockSignInWithOAuth,
      signOut: mockSignOut,
    },
  },
}));

vi.mock('@/lib/profile', () => ({
  getProfile: mockGetProfile,
}));

vi.mock('@/lib/auth', () => ({
  getAuthRedirectUrl: mockGetAuthRedirectUrl,
}));

function authWrapper({ children }: { children: ReactNode }) {
  return createElement(AuthProvider, null, children);
}

describe('useAuth', () => {
  beforeEach(() => {
    authChangeHandler = null;
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ data: { session: null } });
    mockGetProfile.mockResolvedValue(null);
    mockGetAuthRedirectUrl.mockReturnValue('https://app.example.com/auth/callback');
    mockOnAuthStateChange.mockImplementation((handler: typeof authChangeHandler) => {
      authChangeHandler = handler;
      return {
        data: {
          subscription: {
            unsubscribe: mockSubscriptionUnsubscribe,
          },
        },
      };
    });
  });

  it('hydrates an existing session and profile on mount', async () => {
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          access_token: 'token-123',
          user: { id: 'user-1', email: 'user@example.com' },
        },
      },
    });
    mockGetProfile.mockResolvedValue({
      id: 'user-1',
      display_name: 'Coach Royale',
      avatar_url: 'https://example.com/avatar.png',
      subscription_tier: 'free',
    });

    const { result, unmount } = renderHook(() => useAuth(), { wrapper: authWrapper });

    expect(result.current.loading).toBe(true);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user?.id).toBe('user-1');
    expect(result.current.session?.access_token).toBe('token-123');
    expect(result.current.profile?.display_name).toBe('Coach Royale');
    expect(mockGetProfile).toHaveBeenCalledWith('user-1');

    unmount();
    expect(mockSubscriptionUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('reacts to auth state changes after an anonymous bootstrap', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: authWrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.user).toBeNull();

    mockGetProfile.mockResolvedValueOnce({
      id: 'user-2',
      display_name: 'Signed In Later',
      avatar_url: null,
      subscription_tier: 'pro',
    });

    await act(async () => {
      authChangeHandler?.('SIGNED_IN', {
        access_token: 'token-456',
        user: { id: 'user-2', email: 'later@example.com' },
      });
    });

    await waitFor(() => expect(result.current.user?.id).toBe('user-2'));
    expect(result.current.profile?.subscription_tier).toBe('pro');
  });

  it('passes the resolved redirect URL into OAuth sign-in helpers', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper: authWrapper });

    await waitFor(() => expect(result.current.loading).toBe(false));

    await result.current.signInWithDiscord();
    await result.current.signInWithGoogle();
    await result.current.signOut();

    expect(mockSignInWithOAuth).toHaveBeenNthCalledWith(1, {
      provider: 'discord',
      options: { redirectTo: 'https://app.example.com/auth/callback' },
    });
    expect(mockSignInWithOAuth).toHaveBeenNthCalledWith(2, {
      provider: 'google',
      options: { redirectTo: 'https://app.example.com/auth/callback' },
    });
    expect(mockSignOut).toHaveBeenCalledTimes(1);
  });

  it('throws when used outside AuthProvider', () => {
    expect(() => {
      renderHook(() => useAuth());
    }).toThrow(/useAuth must be used within an AuthProvider/);
  });
});
