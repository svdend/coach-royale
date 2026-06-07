import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { customModelText } from "../src/lib/ai";
import type { Env } from "../src/types";

const fullyConfiguredEnv: Env = {
  CUSTOM_MODEL_URL: "https://garage.example.com/v1",
  CUSTOM_MODEL_KEY: "sk-local-123",
  CUSTOM_MODEL_SHARED_SECRET: "edge-secret",
  CUSTOM_MODEL_NAME: "coachroyale-ft-v1",
};

describe("customModelText", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns null when any required config is missing", async () => {
    await expect(customModelText({}, "sys", "user")).resolves.toBeNull();
    await expect(
      customModelText(
        { CUSTOM_MODEL_URL: "https://x", CUSTOM_MODEL_KEY: "k" },
        "sys",
        "user",
      ),
    ).resolves.toBeNull();
    await expect(
      customModelText(
        { CUSTOM_MODEL_URL: "https://x", CUSTOM_MODEL_NAME: "m" },
        "sys",
        "user",
      ),
    ).resolves.toBeNull();
  });

  it("returns the assistant message on a normal OpenAI-style response", async () => {
    const fetchMock = vi.fn<
      (url: string, init: RequestInit) => Promise<Response>
    >(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              { message: { role: "assistant", content: "fine-tuned reply" } },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await customModelText(fullyConfiguredEnv, "sys", "user");
    expect(result).toBe("fine-tuned reply");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://garage.example.com/v1/chat/completions");
    const headers = init.headers as Record<string, string>;
    expect(headers["authorization"]).toBe("Bearer sk-local-123");
    expect(headers["X-Custom-Model-Auth"]).toBe("edge-secret");
    expect(headers["content-type"]).toBe("application/json");
    const body = JSON.parse(init.body as string) as {
      model: string;
      max_tokens: number;
      messages: { role: string; content: string }[];
    };
    expect(body.model).toBe("coachroyale-ft-v1");
    expect(body.max_tokens).toBe(700);
    expect(body.messages).toEqual([
      { role: "system", content: "sys" },
      { role: "user", content: "user" },
    ]);
  });

  it("strips a trailing slash from CUSTOM_MODEL_URL before appending the path", async () => {
    const fetchMock = vi.fn<
      (url: string, init: RequestInit) => Promise<Response>
    >(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await customModelText(
      {
        ...fullyConfiguredEnv,
        CUSTOM_MODEL_URL: "https://garage.example.com/v1/",
      },
      "s",
      "u",
    );
    const [url] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://garage.example.com/v1/chat/completions");
  });

  it("omits the shared-secret header when not configured", async () => {
    const fetchMock = vi.fn<
      (url: string, init: RequestInit) => Promise<Response>
    >(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await customModelText(
      { ...fullyConfiguredEnv, CUSTOM_MODEL_SHARED_SECRET: undefined },
      "s",
      "u",
    );
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Custom-Model-Auth"]).toBeUndefined();
  });

  it("returns null on a non-OK HTTP status", async () => {
    const fetchMock = vi.fn(
      async () => new Response("backend unavailable", { status: 502 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await customModelText(fullyConfiguredEnv, "s", "u");
    expect(result).toBeNull();
  });

  it("returns null when fetch throws (network error or timeout)", async () => {
    const fetchMock = vi.fn<
      (url: string, init: RequestInit) => Promise<Response>
    >(async () => {
      throw new Error("ECONNRESET");
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await customModelText(fullyConfiguredEnv, "s", "u");
    expect(result).toBeNull();
  });

  it("returns null when response body is not valid JSON", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("not json at all", {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await customModelText(fullyConfiguredEnv, "s", "u");
    expect(result).toBeNull();
  });

  it("returns null when the response has no extractable text", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ choices: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await customModelText(fullyConfiguredEnv, "s", "u");
    expect(result).toBeNull();
  });

  it("passes the caller-specified maxTokens to the endpoint", async () => {
    const fetchMock = vi.fn<
      (url: string, init: RequestInit) => Promise<Response>
    >(
      async () =>
        new Response(
          JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await customModelText(fullyConfiguredEnv, "s", "u", 1234);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { max_tokens: number };
    expect(body.max_tokens).toBe(1234);
  });
});
