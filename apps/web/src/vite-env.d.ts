/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
  readonly VITE_AUTH_REDIRECT_URL?: string;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_ANON_KEY?: string;
  readonly VITE_SENTRY_DSN?: string;
  readonly VITE_RELEASE?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Sentry is optional and lazy-loaded. The real package is only installed when
// SENTRY_DSN is configured; the vite test alias points at a local mock.
// Declare a minimal ambient module so tsc can resolve the import without the
// package being installed.
declare module '@sentry/react' {
  export interface SentryInitOptions {
    dsn?: string;
    environment?: string;
    release?: string;
    tracesSampleRate?: number;
    sendDefaultPii?: boolean;
  }
  export function init(options: SentryInitOptions): void;
  export function setUser(user: { id: string; email?: string } | null): void;
  export function captureException(err: unknown): string;
  export function captureMessage(msg: string): string;
  export function withScope(callback: (scope: unknown) => void): void;
}
