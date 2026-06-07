/**
 * Sentry error reporting for the Cloudflare Worker BFF.
 *
 * Disabled by default; requires SENTRY_DSN environment variable to activate.
 * No PII or secrets are captured or transmitted.
 */

export interface SentryConfig {
  dsn?: string;
  environment?: string;
  release?: string;
  enabled: boolean;
}

/**
 * Build Sentry configuration from environment variables.
 * Returns a config object that can be safely used even if Sentry is not enabled.
 */
export function buildSentryConfig(env: {
  SENTRY_DSN?: string;
  ENVIRONMENT?: string;
  RELEASE?: string;
}): SentryConfig {
  const dsn = env.SENTRY_DSN?.trim();
  const enabled = !!dsn;

  return {
    dsn,
    enabled,
    environment: env.ENVIRONMENT || "unknown",
    release: env.RELEASE || "unknown",
  };
}

/**
 * Manually capture an error to Sentry via HTTP POST.
 * Used for Workers runtime where Sentry SDK may not be fully available.
 *
 * This is a lightweight implementation that sends errors to Sentry without
 * requiring the full SDK, which is important for keeping Worker bundle size minimal.
 */
export async function captureWorkerError(
  config: SentryConfig,
  error: {
    message: string;
    stack?: string;
    level?: "fatal" | "error" | "warning" | "info" | "debug";
    tags?: Record<string, string>;
    extra?: Record<string, unknown>;
    requestId?: string;
  },
): Promise<void> {
  if (!config.enabled || !config.dsn) {
    return;
  }

  try {
    // Parse DSN to get project ID and key
    const url = new URL(config.dsn);
    const projectId = url.pathname.split("/").pop();
    const key = url.username;

    if (!projectId || !key) {
      console.error("[Sentry] Invalid DSN format");
      return;
    }

    const sentryUrl = `https://${key}@o${url.host.split(".")[0]}.ingest.sentry.io/${projectId}`;

    // Build Sentry event payload
    const event = {
      message: error.message,
      level: error.level || "error",
      environment: config.environment,
      release: config.release,
      timestamp: Date.now() / 1000,
      platform: "javascript",
      tags: {
        runtime: "cloudflare-worker",
        ...error.tags,
      },
      extra: error.extra,
      exception: error.stack
        ? [
            {
              type: "Error",
              value: error.message,
              stacktrace: {
                frames: parseStackTrace(error.stack),
              },
            },
          ]
        : undefined,
      breadcrumbs: error.requestId
        ? [
            {
              category: "request",
              message: error.requestId,
              level: "debug",
              timestamp: Date.now() / 1000,
            },
          ]
        : undefined,
    };

    // POST to Sentry
    await fetch(`${sentryUrl}/api/${projectId}/store/`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Sentry-Auth": `Bearer ${key}`,
      },
      body: JSON.stringify(event),
    }).catch((err) => {
      console.error("[Sentry] Failed to send event:", err);
    });
  } catch (err) {
    console.error("[Sentry] Error in captureWorkerError:", err);
  }
}

/**
 * Parse a stack trace string into Sentry frame objects.
 */
function parseStackTrace(stack: string): Array<{
  filename: string;
  function: string;
  lineno?: number;
  colno?: number;
}> {
  const frames: Array<{
    filename: string;
    function: string;
    lineno?: number;
    colno?: number;
  }> = [];

  const lines = stack.split("\n").slice(1); // Skip the first line (message)

  for (const line of lines) {
    const match = line.match(/at\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/);
    if (match) {
      frames.push({
        function: match[1],
        filename: match[2],
        lineno: parseInt(match[3], 10),
        colno: parseInt(match[4], 10),
      });
    }
  }

  return frames;
}
