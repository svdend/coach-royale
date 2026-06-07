/**
 * @fileoverview Helpers for Supabase OAuth redirect targets.
 */

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, '');
}

export function resolveAuthRedirectUrl(
  configuredUrl: string | undefined,
  currentOrigin: string | undefined,
): string | undefined {
  const configured = configuredUrl?.trim();
  if (configured) {
    return trimTrailingSlash(configured);
  }

  const origin = currentOrigin?.trim();
  if (origin) {
    return trimTrailingSlash(origin);
  }

  return undefined;
}

export function getAuthRedirectUrl(): string | undefined {
  return resolveAuthRedirectUrl(
    import.meta.env.VITE_AUTH_REDIRECT_URL,
    typeof window !== 'undefined' ? window.location.origin : undefined,
  );
}
