# AI Model Routing Design

This document defines the recommended `free | sft | byok` routing model for the alpha product.

## Goal

Support three distinct user experiences without collapsing them into one ambiguous AI path:

- `free`: a low-cost platform-default lane
- `sft`: a higher-quality platform-managed lane backed by the garage-hosted fine-tuned model
- `byok`: a user-supplied model/provider lane

## Recommended lanes

| Lane | Intended user | Provider/runtime | Request path | Who owns the key |
| --- | --- | --- | --- | --- |
| `anonymous_preview` | anonymous user | deterministic response | browser -> Worker | none |
| `free` | authenticated free-tier user | Cloudflare Workers AI via AI Gateway | browser -> Worker -> Workers AI | platform |
| `sft` | pro/beta/internal user | garage-hosted SFT model behind Cloudflare Tunnel | browser -> Worker -> SFT endpoint | platform |
| `byok_browser` | advanced user bringing their own provider | direct browser call to OpenAI-compatible endpoint | browser -> provider | end user |

## Why this split

- `free` should be cheap, fast, and bounded. Workers AI is the right default platform lane for that.
- `sft` is where differentiated product quality belongs.
- `byok` should not be forced through the same policy as platform-funded inference.

## Key trust boundary

If `BYOK` is browser-direct, the Worker and your servers do not receive the user API key in normal operation.

That does **not** mean the key is magically hidden from all software:

- it is present in the end user's browser storage
- it is readable by code running in that origin context
- it is exposed to the upstream model provider
- it can be compromised by XSS, malicious extensions, or a compromised client device

The strict rule is:

- `browser-direct BYOK`: platform does not handle the key server-side
- `Worker-routed BYOK`: platform can technically access and use the key

If your product promise is "we never see your BYOK secret on our backend," keep BYOK browser-direct.

## Current recommendation

### 1. Free lane

Use Workers AI through AI Gateway.

Characteristics:

- short prompts
- short outputs
- deterministic analytics computed in the Worker first
- caching enabled where safe
- fallback to non-LLM deterministic summary on quota or provider failure

Good workloads:

- quick stats
- short deck tips
- short battle summary
- brief coaching summary

Do not use free lane for:

- long-running conversational coaching
- repeated multi-turn agent loops
- high-token deep analysis

### 2. SFT lane

Use the garage-hosted model as a platform-managed premium lane.

Characteristics:

- accessed only through the Worker
- hidden behind Cloudflare Tunnel instead of a public origin
- explicit timeout and health checks
- circuit breaker and fallback path to Workers AI or deterministic response

Good workloads:

- deep analysis
- weekly plan generation
- premium coach responses

### 3. BYOK lane

Use browser-direct calls to a user-configured OpenAI-compatible endpoint.

Characteristics:

- key stored in browser local storage today
- request sent directly from browser to provider
- no Worker proxy in the strict privacy version
- best suited for advanced users who accept provider-specific CORS and UX limitations

Good workloads:

- custom deep analysis
- testing user-selected models
- self-hosted Ollama / LM Studio / OpenRouter use

## API contract recommendation

Platform-managed lanes should be explicit in the Worker contract.

Recommended request shape:

```json
{
  "lane": "free",
  "type": "quick_stats",
  "prompt": "Give me two adjustments for this player.",
  "playerData": {},
  "route": {
    "allow_fallback": true
  }
}
```

Supported Worker lanes:

- `free`
- `sft`

Unsupported in the Worker contract by default:

- raw user-supplied API keys

BYOK browser-direct should remain a separate client path unless you explicitly choose a different trust model.

## Worker-side routing policy

Recommended decision order:

1. validate auth + subscription
2. validate requested lane against entitlement
3. compute structured analytics locally first
4. route to model backend
5. apply fallback if allowed
6. persist result metadata

Pseudocode:

```ts
if (lane === "free") {
  return runWorkersAiSummary(...);
}

if (lane === "sft") {
  return runSftModelWithFallback(...);
}

throw new Error("Unsupported lane");
```

## Suggested environment variables

### Worker

| Variable | Purpose |
| --- | --- |
| `WORKERS_AI_MODEL` | Workers AI model id |
| `AI_GATEWAY_ID` | AI Gateway identifier |
| `AI_EVENTS` | Analytics Engine dataset binding for AI telemetry |
| `AI_SFT_ENABLED` | enable SFT lane |
| `AI_SFT_BASE_URL` | SFT endpoint URL |
| `AI_SFT_AUTH_TOKEN` | auth token for SFT endpoint |
| `AI_SFT_TIMEOUT_MS` | upstream timeout |
| `AI_SFT_HEALTH_PATH` | health endpoint |
| `AI_DEFAULT_FALLBACK_LANE` | e.g. `free` |

### Web

No user API key should be sent to the Worker for strict BYOK privacy.

Browser-only BYOK config remains:

- `baseUrl`
- `model`
- `apiKey`

## Observability

Track these dimensions separately:

- lane: `free | sft | byok_browser`
- provider: `workers_ai | sft_garage | openrouter | ollama | lm_studio | other`
- model
- latency
- fallback_used
- prompt/output size
- user tier

Do not log raw BYOK secrets.

## Product policy recommendation

Free users:

- allow only `free`

Pro/beta users:

- allow `free`
- allow `sft`
- optionally allow `byok_browser`

Advanced users:

- allow `byok_browser`
- make it explicit that their key is stored locally and sent directly to their provider

## Non-goals for alpha

Avoid these until you actually need them:

- per-user encrypted BYOK storage on the backend
- Worker-routed BYOK proxying
- complex multi-provider policy engines
- dynamic model marketplace UI

The alpha should keep the lanes obvious and the trust model easy to explain.
