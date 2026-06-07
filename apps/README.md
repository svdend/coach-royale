# Applications

This directory contains the active runtime components for the rebuilt architecture.

| Path | Runtime | Responsibility |
| --- | --- | --- |
| `web` | React 19 + Vite | Static UI, Supabase session management, BFF client |
| `api-worker` | Cloudflare Worker + Hono | API aggregation, sync, AI orchestration, billing, authenticated user-data endpoints |
| `relay` | FastAPI | Static-IP Supercell proxy only |

Request flow:

1. The browser loads the static app from Cloudflare Pages.
2. The web app calls the Worker BFF for player sync, analysis, coaching, billing, tracked players, and analysis history.
3. The Worker stores application data in Supabase and calls Anthropic and Lemon Squeezy directly.
4. The Worker calls the relay only when a Supercell request must originate from the allowlisted VPS IP.

The intended dependency direction is:

- `web -> api-worker`
- `api-worker -> relay`
- `api-worker -> Supabase / Anthropic / Lemon Squeezy`
- `relay -> Supercell`

The relay is deliberately small. Product logic should stay in the Worker unless the static-IP requirement forces a VPS hop.
