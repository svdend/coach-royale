# Content Security Policy baseline (declaw web)

The Vite SPA (`apps/web`) does not inject a strict CSP meta tag during local development because Vite HMR and `@vitejs/plugin-react` rely on `eval`/`blob:` in some setups.

## Production recommendation

Serve the built static assets (`npm run build` output) with **response headers** (Cloudflare Pages _headers, nginx, etc.) similar to:

```
Content-Security-Policy: default-src 'self'; base-uri 'self'; frame-ancestors 'none'; object-src 'none'; img-src 'self' data: https:; font-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://relay.coach-royale.com https://*.coach-royale.com https://discord.com https://accounts.google.com
```

Adjust `connect-src` for:

- Your Supabase project host(s)
- Your Worker API origin (`VITE_API_BASE_URL`)
- OAuth providers in use (Discord, Google)

## BYOK / custom model

Custom OpenAI-compatible keys are stored **only in the browser** (`localStorage`). Requests go from the browser to the user-configured provider. Document this in-product (see `ModelConfigPanel` copy) and keep CSP `connect-src` aligned with allowed provider hosts if you offer presets.
