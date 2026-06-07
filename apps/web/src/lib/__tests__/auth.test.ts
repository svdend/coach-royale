import { describe, expect, it } from 'vitest';

import { resolveAuthRedirectUrl } from '../auth';

describe('resolveAuthRedirectUrl', () => {
  it('prefers an explicit configured redirect URL', () => {
    expect(
      resolveAuthRedirectUrl('https://coach-royale.com/', 'https://preview.coach-royale-web.pages.dev'),
    ).toBe('https://coach-royale.com');
  });

  it('falls back to the current origin when no override is configured', () => {
    expect(resolveAuthRedirectUrl(undefined, 'https://coach-royale.com/')).toBe(
      'https://coach-royale.com',
    );
  });

  it('returns undefined when neither source exists', () => {
    expect(resolveAuthRedirectUrl(undefined, undefined)).toBeUndefined();
  });
});
