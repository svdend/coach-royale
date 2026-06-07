import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getAuthRedirectUrl } from '@/lib/auth';
import { getProfile } from '@/lib/profile';
import { supabase } from '@/lib/supabase';
import { AuthContext, type AuthContextValue, type AuthState } from '@/auth/context';
import { setSentryUser } from '@/lib/sentry';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    session: null,
    profile: null,
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;

    async function applySession(session: Session | null) {
      let profile = null;
      if (session?.user) {
        try {
          profile = await getProfile(session.user.id);
        } catch (error) {
          console.error('Failed to load auth profile:', error);
        }
      }

      if (!cancelled) {
        setState({ user: session?.user ?? null, session, profile, loading: false });
        // Update Sentry user context on auth state change
        setSentryUser(session?.user ?? null);
      }
    }

    void supabase.auth.getSession().then(({ data: { session } }) => applySession(session));

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, session) => {
      void applySession(session);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  const signInWithDiscord = useCallback(() => {
    const redirectTo = getAuthRedirectUrl();
    return supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: redirectTo ? { redirectTo } : undefined,
    });
  }, []);

  const signInWithGoogle = useCallback(() => {
    const redirectTo = getAuthRedirectUrl();
    return supabase.auth.signInWithOAuth({
      provider: 'google',
      options: redirectTo ? { redirectTo } : undefined,
    });
  }, []);

  const signOut = useCallback(() => supabase.auth.signOut(), []);

  const refreshProfile = useCallback(async () => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.user) {
      setState((prev) => ({ ...prev, profile: null }));
      return;
    }
    try {
      const profile = await getProfile(session.user.id);
      setState((prev) => ({ ...prev, profile }));
    } catch (error) {
      console.error('Failed to refresh auth profile:', error);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      ...state,
      signInWithDiscord,
      signInWithGoogle,
      signOut,
      refreshProfile,
    }),
    [state, signInWithDiscord, signInWithGoogle, signOut, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
