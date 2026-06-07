import { cleanup } from '@testing-library/react';
import * as matchers from '@testing-library/jest-dom/matchers';
import { afterEach, expect } from 'vitest';

expect.extend(matchers);

// Fail loudly if jsdom didn't initialize a working localStorage. Several
// tests (e.g. modelConfig.test.ts) call localStorage.clear() directly in
// beforeEach. If the test environment isn't 'jsdom' (vite.config.ts) — or
// if Node's compat with jsdom regresses on a future major — we want a
// targeted error instead of a confusing "TypeError: localStorage.clear is
// not a function" deep inside a hook.
if (
  typeof globalThis.localStorage === 'undefined' ||
  typeof globalThis.localStorage.clear !== 'function'
) {
  throw new Error(
    'Test environment is missing a working localStorage. ' +
      "Confirm Vitest is running with environment: 'jsdom' (see vite.config.ts). " +
      'If you are on a recent Node major, also check .nvmrc — Node 20 is the supported version.',
  );
}

afterEach(() => {
  cleanup();
});
