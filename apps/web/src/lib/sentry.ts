/**
 * Sentry error reporting for the React web app.
 *
 * Disabled by default; requires VITE_SENTRY_DSN to activate.
 * The real @sentry/react SDK is loaded lazily so the app bundle stays small
 * when Sentry is off.
 */

import type { User } from '@supabase/supabase-js';

interface SentryRuntime {
  setUser: (user: { id: string; email?: string } | null) => void;
}

let runtime: SentryRuntime | null = null;

function getDsn(): string | undefined {
  const raw = import.meta.env.VITE_SENTRY_DSN;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Initialize Sentry if VITE_SENTRY_DSN is set. No-op otherwise.
 *
 * Safe to call multiple times. Returns once initialization (or the decision
 * not to initialize) is complete so callers can `void initSentry()`.
 */
export async function initSentry(): Promise<void> {
  const dsn = getDsn();
  if (!dsn || runtime !== null) return;

  try {
    const Sentry = await import('@sentry/react');
    Sentry.init({
      dsn,
      environment: import.meta.env.MODE,
      release: import.meta.env.VITE_RELEASE ?? 'unknown',
      tracesSampleRate: 0,
      sendDefaultPii: false,
    });
    runtime = {
      setUser: (user) => Sentry.setUser(user),
    };
  } catch (err) {
    // Sentry is optional — never block the app on its absence.
    console.warn('[sentry] failed to initialize:', err);
  }
}

/**
 * Update Sentry's user context on auth state changes. No-op when disabled.
 *
 * Sends only the Supabase user id (no email, no PII).
 */
export function setSentryUser(user: User | null): void {
  if (runtime === null) return;
  runtime.setUser(user === null ? null : { id: user.id });
}
