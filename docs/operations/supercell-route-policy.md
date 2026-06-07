# Supercell-shaped API policy (Worker → relay)

This document complements the Worker implementation in `apps/api-worker/src/index.ts`.

## Caching

Public `GET` routes that proxy the relay return short `Cache-Control` hints so browsers and any intermediate cache can reuse responses briefly:

| Route pattern | Intent |
|---------------|--------|
| `/api/player/:tag` | Player snapshot — `max-age=60` |
| `/api/player/:tag/battles` | Higher churn — `max-age=30` |
| `/api/player/:tag/chests` | `max-age=120` |
| `/api/player/:tag/analytics` | Derived analytics — `max-age=15` |
| `/api/clan/:tag` | `max-age=120` |
| `/api/cards` | Static catalog — `max-age=3600` |

`POST /api/player/:tag/sync` and authenticated routes are **not** given public cache headers.

## Rate limiting (Cloudflare)

Per-route rate limits are **not** encoded in this repository because they require a Cloudflare Rate Limiting binding and dashboard configuration.

Recommended defaults for production:

- **Anonymous** clients: stricter limits on `/api/player/*` and `/api/ai/*` to protect relay and AI budgets.
- **Authenticated** clients: higher limits keyed by user id (JWT) where the Worker can derive identity.

Apply limits at the **Worker edge** (or zone rules) ahead of the relay to absorb abusive traffic before it reaches the relay service.

## Authenticated vs anonymous

- Relay calls use the shared relay secret; end users never send the relay secret.
- Managed AI and billing routes require `Authorization: Bearer` (Supabase JWT) as enforced in route handlers.
