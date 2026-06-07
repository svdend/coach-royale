import { useContext } from 'react';
import { SubscriptionContext, type SubscriptionContextValue } from '@/auth/subscription-context';

export type { SubscriptionContextValue } from '@/auth/subscription-context';

export function useSubscription(): SubscriptionContextValue {
  const ctx = useContext(SubscriptionContext);
  if (!ctx) {
    throw new Error('useSubscription must be used within a SubscriptionProvider');
  }
  return ctx;
}
