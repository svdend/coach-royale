import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    // Regular unit + integration tests. The eval harness lives under
    // eval/**/*.eval.ts and is run separately via npm run eval:agent —
    // we DO include its small helper tests (eval/tests/**) here so
    // the rule-based judge and report writer are covered on every
    // CI run without requiring Anthropic credentials.
    include: ["tests/**/*.test.ts", "eval/tests/**/*.test.ts"],
  },
});
