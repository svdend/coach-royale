import { defineConfig } from "vitest/config";

/**
 * Separate vitest config for the agent eval harness (AG6, cr-c0y).
 *
 * Invoked via `npm run eval:agent`. Picks up *.eval.ts files which are
 * excluded from the default test run (see vitest.config.ts) so they
 * don't slow down CI or require Anthropic credentials.
 *
 * Intentionally uses a single-worker pool and generous timeouts: the
 * harness runs the full fixture set against real Anthropic and each
 * backend call can take 10+ seconds.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["eval/**/*.eval.ts"],
    pool: "forks",
    poolOptions: {
      forks: { singleFork: true },
    },
    // Per-test timeout. The harness file uses its own `it()` timeout,
    // but this prevents hangs if anything goes wrong in setup.
    testTimeout: 15 * 60_000,
    hookTimeout: 30_000,
    reporters: ["default"],
  },
});
