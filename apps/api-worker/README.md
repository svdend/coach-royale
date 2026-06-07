# API Worker

`apps/api-worker` is the Cloudflare Worker backend-for-frontend for the alpha workload.

## Responsibilities

- Proxy read-only Clash Royale data through the relay
- Persist tracked players, snapshots, battles, subscriptions, and analysis history in Supabase
- Generate analytics, coaching summaries, weekly plans, and quick AI responses
- Own billing checkout creation and webhook handling
- Enforce authenticated access for user-scoped endpoints
- Expose GDPR-oriented privacy endpoints for export, erasure, and retention settings

## Route groups

- Player data: `/api/player/:tag`, `/api/player/:tag/battles`, `/api/player/:tag/chests`, `/api/clan/:tag`, `/api/cards`
- Persistence: `/api/player/:tag/sync`, `/api/tracked-players`, `/api/analysis-history`
- Player analytics (deterministic, relay-only): `GET /api/player/:tag/analytics`
- Managed deep analysis (AI): `POST /api/analysis` with JSON `{ "tag": "#2PP" }`
- Coaching: `/api/ai/respond`, `/api/coach/weekly-plan/:tag`, `/api/coach/question/:tag`
- Billing: `/api/payments/checkout`, `/api/payments/subscription/:userId`, `/api/payments/webhook`
- Privacy: `/api/gdpr/settings`, `/api/gdpr/export`, `/api/gdpr/erase`

## Environment variables

| Variable                      | Purpose                                                                |
| ----------------------------- | ---------------------------------------------------------------------- |
| `ALLOWED_ORIGINS`             | CORS allowlist                                                         |
| `RELAY_BASE_URL`              | Base URL for the static-IP relay                                       |
| `RELAY_SHARED_SECRET`         | Shared secret sent to the relay                                        |
| `SUPABASE_URL`                | Supabase project URL                                                   |
| `SUPABASE_ANON_KEY`           | Used for token introspection                                           |
| `SUPABASE_SERVICE_ROLE_KEY`   | Used for server-side writes                                            |
| `ANTHROPIC_API_KEY`           | Pro-lane live AI responses; missing key returns `coaching_unavailable` |
| `ANTHROPIC_MODEL`             | Anthropic model name                                                   |
| `WORKERS_AI_MODEL`            | Workers AI free-lane model id                                          |
| `AI_GATEWAY_ID`               | Cloudflare AI Gateway id for free-lane calls                           |
| `AI_EVENTS`                   | Analytics Engine dataset binding for AI telemetry                      |
| `LEMONSQUEEZY_API_KEY`        | Checkout creation                                                      |
| `LEMONSQUEEZY_STORE_ID`       | Billing store identifier                                               |
| `LEMONSQUEEZY_VARIANT_ID`     | Billing variant identifier                                             |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | Webhook HMAC verification                                              |
| `APP_BASE_URL`                | Optional application URL context                                       |
| `STRUCTURED_LOGS_ENABLED`     | Optional JSON request logs when set to `true`; defaults off            |

## Commands

- `npm run lint`
- `npm run test`
- `npm run build`
- `npm run deploy:dry-run`
- `npm run render:production-config`
- `npm run verify:remote-secrets`

## Production deploy contract

Production deploys do not publish directly from the checked-in `wrangler.toml`.
The GitHub workflow renders `.wrangler/production.toml` from explicit `WORKER_*`
environment variables, then verifies the Cloudflare-side secret set before
deploying.

Required GitHub environment variables for `production-worker`:

- `WORKER_ALLOWED_ORIGINS`
- `WORKER_ANTHROPIC_MODEL`
- `WORKER_WORKERS_AI_MODEL`
- `WORKER_AI_GATEWAY_ID`
- `WORKER_RELAY_BASE_URL`
- `WORKER_SUPABASE_URL`
- `WORKER_LEMONSQUEEZY_STORE_ID`
- `WORKER_LEMONSQUEEZY_VARIANT_ID`
- optional: `WORKER_AI_EVENTS_DATASET`
- optional: `WORKER_APP_BASE_URL`

Required Cloudflare Worker secrets:

- `RELAY_SHARED_SECRET`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LEMONSQUEEZY_API_KEY`
- `LEMONSQUEEZY_WEBHOOK_SECRET`
- optional: `ANTHROPIC_API_KEY`

## Design notes

- The Worker should stay thin and orchestration-heavy.
- Heavy compute should not be pushed into the Worker just because it is convenient.
- The relay is the only runtime that should know the Supercell token.
- Webhook verification uses Web Crypto, not Node-only crypto APIs, so the code stays Worker-native.
- Signed billing webhooks are rejected unless they include a valid Supabase user id, subscription id, and subscription status.
- The Worker emits browser security headers on every response and only emits HSTS for HTTPS requests.
- The Worker emits `X-Request-ID` on responses, forwards it to the relay, and exposes `/api/ready` for dependency checks.
- Anonymous coaching preview remains available only when no auth credential is supplied; invalid bearer tokens fail closed instead of downgrading to anonymous access.
- Privacy export includes only server-side data. Browser-only BYOK config and local usage counters are intentionally excluded.
- Retention enforcement runs after sync, analysis persistence, free-lane usage accounting, and privacy-setting updates to keep snapshots, battles, analysis history, and free AI usage rows within the selected window.
- Tracked players, saved deck records, profile fields, subscription state, and privacy acknowledgements are erase-only account records in the current alpha. They are exported, but not pruned by the rolling retention window.

## Recommended AI routing model

The Worker should own only platform-managed lanes:

- `free` -> Workers AI through AI Gateway for authenticated free users; anonymous users keep deterministic preview responses
- `sft` -> garage-hosted fine-tuned model behind the Worker

Strict-privacy BYOK should remain browser-direct, not proxied through the Worker. If the Worker receives the raw user API key, the platform can technically access it and the trust model changes.

See [docs/architecture/model-routing.md](../../docs/architecture/model-routing.md).
