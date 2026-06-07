# Web App

`apps/web` is the static frontend intended for Cloudflare Pages.

## Responsibilities

- Render the player search, stats, battle log, coaching, and subscription UI
- Manage Supabase OAuth/session state in the browser
- Call the Worker BFF for sync, AI, billing, tracked players, and analysis history
- Expose the privacy center for export, erasure, retention, and local-data cleanup

## Current boundary

Core writes no longer go directly from the browser to Supabase for sync/history flows. Those now go through the Worker BFF.

The remaining direct browser-to-Supabase path is:

- OAuth/session handling
- profile reads used by the auth hook

## Environment variables

| Variable                 | Purpose                                                     |
| ------------------------ | ----------------------------------------------------------- |
| `VITE_API_BASE_URL`      | Optional override for the BFF base URL                      |
| `VITE_AUTH_REDIRECT_URL` | Optional explicit OAuth redirect target for this deployment |
| `VITE_SUPABASE_URL`      | Supabase project URL                                        |
| `VITE_SUPABASE_ANON_KEY` | Public anon key used by the browser client                  |

Defaults:

- Local API default: `http://localhost:8787/api`
- Non-local API default: `https://relay.coach-royale.com/api`

## Commands

- `npm run dev`
- `npm run lint`
- `npm run test`
- `npm run build`
- `npm run preview`

## Key integration points

- `src/lib/api.ts` owns all BFF calls and auth header attachment.
- `src/auth/AuthProvider.tsx` + `src/auth/context.tsx` own a single Supabase auth listener and profile load per session (`useAuth` in `src/hooks/useAuth.ts`). `src/auth/SubscriptionProvider.tsx` performs one subscription-status fetch per signed-in user and shares tier/limits via `useSubscription` (`src/hooks/useSubscription.ts`). Both providers wrap the app in `src/main.tsx`.
- `src/lib/auth.ts` resolves the correct OAuth redirect target for the current deployment.
- `src/App.tsx` triggers best-effort server-side sync after search when a user session exists.
- `src/components/PrivacyCenter.tsx` owns export, erase, retention, and local browser cleanup.

## Notes

- The production build now lazy-loads the analysis, coach, privacy, and tracked-player surfaces so the main application chunk stays smaller and the previous large-chunk warning is gone.
- If `VITE_AUTH_REDIRECT_URL` is unset, OAuth falls back to `window.location.origin`. That origin still needs to be allowlisted in Supabase Auth settings.
- Outside local dev and test, the app now throws during startup if `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` is missing or still set to the template placeholder.

## BYOK trust boundary

The current custom model path is intended to be browser-direct:

- the user enters `baseUrl`, `model`, and `apiKey` in the UI
- the config is stored locally in the browser
- requests go directly from browser to the user-selected provider

In that design, the Worker does not receive the raw BYOK secret during normal operation.

Important caveat:

- the key is still present on the client device
- it is visible to code running in the page context
- it is exposed to the upstream provider

If you need the product promise to remain "we do not see your model key on our backend," do not move BYOK behind the Worker.

See [docs/architecture/model-routing.md](../../docs/architecture/model-routing.md).

## Privacy Center

The current privacy surface is intentionally pragmatic:

- export the server-side user dataset as JSON
- erase the authenticated user account plus cloud data
- configure retention for snapshots, battles, and analysis history to `30`, `90`, or `365` days
- keep tracked players, saved deck records, and profile/subscription records until account erasure
- clear browser-only data such as BYOK config, last searched tag, and local usage counters

This is a meaningful GDPR-oriented baseline, not a blanket legal-compliance guarantee.
