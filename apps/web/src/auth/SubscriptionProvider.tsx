import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { getSubscriptionStatus, createCheckout } from '@/lib/api';
import { SubscriptionContext, type SubscriptionContextValue } from '@/auth/subscription-context';

interface BackendResult {
  tier: 'free' | 'pro';
  limits: { quick_analysis: number; deep_analysis: number };
  usage_today: { quick_analysis: number; deep_analysis: number };
  fetched: true;
}

const FREE_LIMITS = { quick_analysis: 5, deep_analysis: 1 };
const PRO_LIMITS = { quick_analysis: 999, deep_analysis: 999 };
const ZERO_USAGE = { quick_analysis: 0, deep_analysis: 0 };

export function SubscriptionProvider({ children }: { children: ReactNode }) {
  const { user, profile } = useAuth();
  const [backendResult, setBackendResult] = useState<BackendResult | null>(null);
  const fetchedForRef = useRef<string | null>(null);

  const applySubscriptionPayload = useCallback(
    (data: {
      tier: 'free' | 'pro';
      limits: { quick_analysis: number; deep_analysis: number };
      usage_today: { quick_analysis: number; deep_analysis: number };
    }) => {
      setBackendResult({
        tier: data.tier,
        limits: data.limits,
        usage_today: data.usage_today,
        fetched: true,
      });
      if (user?.id) {
        fetchedForRef.current = user.id;
      }
    },
    [user],
  );

  const fetchSubscription = useCallback(async () => {
    if (!user?.id || profile?.subscription_tier === 'pro') {
      return;
    }
    try {
      const data = await getSubscriptionStatus(user.id);
      applySubscriptionPayload(data);
    } catch {
      setBackendResult({
        tier: 'free',
        limits: FREE_LIMITS,
        usage_today: ZERO_USAGE,
        fetched: true,
      });
      if (user.id) {
        fetchedForRef.current = user.id;
      }
    }
  }, [user, profile, applySubscriptionPayload]);

  useEffect(() => {
    if (!user) {
      fetchedForRef.current = null;
      return;
    }

    if (profile?.subscription_tier === 'pro') return;
    if (fetchedForRef.current === user.id) return;

    let cancelled = false;
    void (async () => {
      try {
        const data = await getSubscriptionStatus(user.id);
        if (!cancelled) {
          applySubscriptionPayload(data);
        }
      } catch {
        if (!cancelled) {
          setBackendResult({
            tier: 'free',
            limits: FREE_LIMITS,
            usage_today: ZERO_USAGE,
            fetched: true,
          });
          fetchedForRef.current = user.id;
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [user, profile, applySubscriptionPayload]);

  let tier: 'free' | 'pro' = 'free';
  let limits = FREE_LIMITS;
  let loading = false;

  if (!user) {
    tier = 'free';
    limits = FREE_LIMITS;
  } else if (profile?.subscription_tier === 'pro') {
    tier = 'pro';
    limits = PRO_LIMITS;
  } else if (backendResult) {
    tier = backendResult.tier;
    limits = backendResult.limits;
  } else {
    loading = true;
  }

  const isPro = tier === 'pro';

  const usageToday: { quick_analysis: number; deep_analysis: number } | null = !user
    ? null
    : isPro
      ? ZERO_USAGE
      : backendResult
        ? backendResult.usage_today
        : null;

  const upgrade = useCallback(async () => {
    if (!user?.email || !user?.id) return;
    try {
      const { checkout_url } = await createCheckout(user.email, user.id);
      window.location.href = checkout_url;
    } catch (e) {
      console.error('Failed to create checkout:', e);
    }
  }, [user]);

  const refresh = useCallback(async () => {
    fetchedForRef.current = null;
    await fetchSubscription();
  }, [fetchSubscription]);

  const value = useMemo<SubscriptionContextValue>(
    () => ({
      tier,
      isPro,
      loading,
      limits,
      usageToday,
      refresh,
      upgrade,
    }),
    [tier, isPro, loading, limits, usageToday, refresh, upgrade],
  );

  return <SubscriptionContext.Provider value={value}>{children}</SubscriptionContext.Provider>;
}
