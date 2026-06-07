/**
 * Pure unit tests for the 4th-lane routing gate (P1.4).
 *
 * Verifies that providerForAccess() honors the following priority:
 *   1. No user  -> "deterministic"
 *   2. Operator user with custom lane fully configured -> "custom"
 *   3. Operator user but custom lane misconfigured -> falls back to tier rule
 *   4. Non-operator Pro user -> "anthropic"
 *   5. Non-operator free user -> "workers_ai"
 */

import { describe, expect, it } from "vitest";

import {
  customLaneConfigured,
  isOperator,
  modelForProvider,
  parseOperatorIds,
  providerForAccess,
  type AccessContext,
} from "../src/lib/provider-routing";
import type { Env } from "../src/types";

const OP_ID_1 = "00000000-0000-0000-0000-000000000001";
const OP_ID_2 = "00000000-0000-0000-0000-000000000002";
const REGULAR_ID = "00000000-0000-0000-0000-000000000003";

const fullCustomEnv: Env = {
  OPERATOR_USER_IDS: `${OP_ID_1}, ${OP_ID_2}`,
  CUSTOM_MODEL_URL: "https://garage.example.com/v1",
  CUSTOM_MODEL_KEY: "k",
  CUSTOM_MODEL_NAME: "coachroyale-ft-v1",
};

describe("parseOperatorIds", () => {
  it("returns empty set for undefined input", () => {
    expect(parseOperatorIds(undefined).size).toBe(0);
  });
  it("returns empty set for empty string", () => {
    expect(parseOperatorIds("").size).toBe(0);
  });
  it("parses single id", () => {
    const ids = parseOperatorIds(OP_ID_1);
    expect(ids.has(OP_ID_1)).toBe(true);
    expect(ids.size).toBe(1);
  });
  it("parses comma-separated with whitespace", () => {
    const ids = parseOperatorIds(` ${OP_ID_1} , ${OP_ID_2} `);
    expect(ids.has(OP_ID_1)).toBe(true);
    expect(ids.has(OP_ID_2)).toBe(true);
    expect(ids.size).toBe(2);
  });
  it("ignores empty segments from stray commas", () => {
    const ids = parseOperatorIds(`,,${OP_ID_1},,`);
    expect(ids.size).toBe(1);
  });
});

describe("isOperator", () => {
  it("returns false when user id is null/undefined", () => {
    expect(isOperator(fullCustomEnv, null)).toBe(false);
    expect(isOperator(fullCustomEnv, undefined)).toBe(false);
  });
  it("returns true for an operator id", () => {
    expect(isOperator(fullCustomEnv, OP_ID_1)).toBe(true);
    expect(isOperator(fullCustomEnv, OP_ID_2)).toBe(true);
  });
  it("returns false for a non-operator id", () => {
    expect(isOperator(fullCustomEnv, REGULAR_ID)).toBe(false);
  });
  it("returns false when OPERATOR_USER_IDS is unset", () => {
    expect(isOperator({}, OP_ID_1)).toBe(false);
  });
});

describe("customLaneConfigured", () => {
  it("returns true when all three env vars are set", () => {
    expect(customLaneConfigured(fullCustomEnv)).toBe(true);
  });
  it("returns false when URL is missing", () => {
    expect(
      customLaneConfigured({ ...fullCustomEnv, CUSTOM_MODEL_URL: undefined }),
    ).toBe(false);
  });
  it("returns false when KEY is missing", () => {
    expect(
      customLaneConfigured({ ...fullCustomEnv, CUSTOM_MODEL_KEY: undefined }),
    ).toBe(false);
  });
  it("returns false when NAME is missing", () => {
    expect(
      customLaneConfigured({ ...fullCustomEnv, CUSTOM_MODEL_NAME: undefined }),
    ).toBe(false);
  });
});

describe("providerForAccess", () => {
  const anonAccess: AccessContext = { user: null, tier: "free" };
  const freeAccess: AccessContext = {
    user: { id: REGULAR_ID },
    tier: "free",
  };
  const proAccess: AccessContext = {
    user: { id: REGULAR_ID },
    tier: "pro",
  };
  const operatorFreeAccess: AccessContext = {
    user: { id: OP_ID_1 },
    tier: "free",
  };
  const operatorProAccess: AccessContext = {
    user: { id: OP_ID_1 },
    tier: "pro",
  };

  it("anonymous user -> deterministic", () => {
    expect(providerForAccess(anonAccess, fullCustomEnv)).toBe("deterministic");
  });

  it("non-operator free user -> workers_ai", () => {
    expect(providerForAccess(freeAccess, fullCustomEnv)).toBe("workers_ai");
  });

  it("non-operator pro user -> anthropic", () => {
    expect(providerForAccess(proAccess, fullCustomEnv)).toBe("anthropic");
  });

  it("operator user (even free tier) with custom lane configured -> custom", () => {
    expect(providerForAccess(operatorFreeAccess, fullCustomEnv)).toBe("custom");
    expect(providerForAccess(operatorProAccess, fullCustomEnv)).toBe("custom");
  });

  it("operator user but CUSTOM_MODEL_URL missing -> falls back to tier rule", () => {
    const env = { ...fullCustomEnv, CUSTOM_MODEL_URL: undefined };
    expect(providerForAccess(operatorProAccess, env)).toBe("anthropic");
    expect(providerForAccess(operatorFreeAccess, env)).toBe("workers_ai");
  });

  it("operator user but CUSTOM_MODEL_KEY missing -> falls back to tier rule", () => {
    const env = { ...fullCustomEnv, CUSTOM_MODEL_KEY: undefined };
    expect(providerForAccess(operatorProAccess, env)).toBe("anthropic");
  });

  it("operator user but CUSTOM_MODEL_NAME missing -> falls back to tier rule", () => {
    const env = { ...fullCustomEnv, CUSTOM_MODEL_NAME: undefined };
    expect(providerForAccess(operatorProAccess, env)).toBe("anthropic");
  });

  it("no OPERATOR_USER_IDS set -> no user is routed to custom", () => {
    const env: Env = {
      CUSTOM_MODEL_URL: "https://x/v1",
      CUSTOM_MODEL_KEY: "k",
      CUSTOM_MODEL_NAME: "n",
    };
    expect(providerForAccess(operatorProAccess, env)).toBe("anthropic");
  });
});

describe("modelForProvider", () => {
  it("returns configured workers_ai model", () => {
    expect(
      modelForProvider({ WORKERS_AI_MODEL: "@cf/custom" }, "workers_ai"),
    ).toBe("@cf/custom");
  });
  it("returns default workers_ai model when unset", () => {
    expect(modelForProvider({}, "workers_ai")).toBe("@cf/openai/gpt-oss-20b");
  });
  it("returns configured anthropic model", () => {
    expect(
      modelForProvider({ ANTHROPIC_MODEL: "claude-sonnet-4" }, "anthropic"),
    ).toBe("claude-sonnet-4");
  });
  it("returns default anthropic model when unset", () => {
    expect(modelForProvider({}, "anthropic")).toBe("claude-sonnet-4-20250514");
  });
  it("returns configured custom model name", () => {
    expect(modelForProvider({ CUSTOM_MODEL_NAME: "my-ft-v2" }, "custom")).toBe(
      "my-ft-v2",
    );
  });
  it("returns 'custom-unknown' placeholder when custom name is unset", () => {
    expect(modelForProvider({}, "custom")).toBe("custom-unknown");
  });
  it("returns deterministic-fallback sentinel for deterministic provider", () => {
    expect(modelForProvider({}, "deterministic")).toBe(
      "deterministic-fallback",
    );
  });
});
