import type { Env } from "../types";
import { fetchJson } from "./http";

const LEMON_API_BASE = "https://api.lemonsqueezy.com/v1";
const TEXT_ENCODER = new TextEncoder();

function hexToBytes(value: string): Uint8Array | null {
  if (value.length % 2 !== 0 || /[^a-fA-F0-9]/.test(value)) {
    return null;
  }

  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) {
    return false;
  }

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left[index] ^ right[index];
  }
  return diff === 0;
}

async function signHmacSha256(
  secret: string,
  rawBody: string,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    TEXT_ENCODER.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    TEXT_ENCODER.encode(rawBody),
  );
  return new Uint8Array(signature);
}

export function mapSubscriptionStatusToTier(status: string): "free" | "pro" {
  return ["active", "on_trial", "paid", "past_due"].includes(status)
    ? "pro"
    : "free";
}

export async function createCheckoutUrl(
  env: Env,
  userEmail: string,
  userId: string,
): Promise<{ checkout_url: string }> {
  if (
    !env.LEMONSQUEEZY_API_KEY ||
    !env.LEMONSQUEEZY_STORE_ID ||
    !env.LEMONSQUEEZY_VARIANT_ID
  ) {
    throw new Error("Lemon Squeezy is not configured");
  }

  const appBase = env.APP_BASE_URL?.trim().replace(/\/$/, "");
  const attributes: Record<string, unknown> = {
    checkout_data: {
      email: userEmail,
      custom: {
        user_id: userId,
      },
    },
  };
  if (appBase) {
    attributes.checkout_options = {
      redirect_url: `${appBase}/?upgraded=true`,
    };
  }

  const payload = {
    data: {
      type: "checkouts",
      attributes,
      relationships: {
        store: {
          data: { type: "stores", id: env.LEMONSQUEEZY_STORE_ID },
        },
        variant: {
          data: { type: "variants", id: env.LEMONSQUEEZY_VARIANT_ID },
        },
      },
    },
  };

  const response = await fetchJson<{
    data: { attributes: { url: string } };
  }>(`${LEMON_API_BASE}/checkouts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.LEMONSQUEEZY_API_KEY}`,
      "Content-Type": "application/vnd.api+json",
      Accept: "application/vnd.api+json",
    },
    body: JSON.stringify(payload),
  });

  return { checkout_url: response.data.attributes.url };
}

export async function verifyWebhookSignature(
  secret: string | undefined,
  rawBody: string,
  signature: string | undefined,
): Promise<boolean> {
  if (!secret || !signature) {
    return false;
  }

  const provided = hexToBytes(signature.trim());
  if (!provided) {
    return false;
  }

  const digest = await signHmacSha256(secret, rawBody);
  return constantTimeEqual(digest, provided);
}
