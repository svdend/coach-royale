import { createContext } from 'react';

export interface SubscriptionContextValue {
  tier: 'free' | 'pro';
  isPro: boolean;
  loading: boolean;
  limits: { quick_analysis: number; deep_analysis: number };
  /** Server-backed counts for today (signed-in free users). Null when signed out. */
  usageToday: { quick_analysis: number; deep_analysis: number } | null;
  /** Re-fetch subscription + usage from the Worker (after a successful AI call). */
  refresh: () => Promise<void>;
  upgrade: () => Promise<void>;
}

export const SubscriptionContext = createContext<SubscriptionContextValue | null>(null);
