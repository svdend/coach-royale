/**
 * Test-only mock for @sentry/react.
 *
 * Aliased into vite.config.ts so tests do not require the real SDK to be
 * installed. All exports are pass-through no-ops.
 */

export const init = (): void => undefined;
export const setUser = (): void => undefined;
export const captureException = (): string => 'mock';
export const captureMessage = (): string => 'mock';
export const withScope = (callback: (scope: unknown) => void): void => {
  callback({
    setTag: () => undefined,
    setExtra: () => undefined,
    setUser: () => undefined,
  });
};
