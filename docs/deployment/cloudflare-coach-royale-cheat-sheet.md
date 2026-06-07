# Cloudflare Deploy Cheat Sheet (`coach-royale.com`)

Use this checklist to deploy `coachhroyale_cf_bff` to Cloudflare and serve it at `https://coach-royale.com` with the static-IP Supercell relay path preserved.

## 1) Access and prerequisites

- GitHub repo exists and is reachable.
- `wrangler` is installed and authenticated.
- DNS for `coach-royale.com` is in Cloudflare.

```bash
npm i -g wrangler
wrangler login
gh auth status
```

## 2) Required credentials and IDs

Create/use a scoped Cloudflare API token with:

- `Account:Cloudflare Pages:Edit`
- `Account:Workers Scripts:Edit`
- `Account:Workers Routes:Edit` (if routing `/api/*`)
- `Zone:DNS:Edit`
- `Zone:Zone Settings:Edit` (optional but useful)

Collect:

- `CF_API_TOKEN`
- `CF_ACCOUNT_ID`
- `CF_ZONE_ID` (for `coach-royale.com`)

```bash
curl -s -X GET "https://api.cloudflare.com/client/v4/zones?name=coach-royale.com" \
  -H "Authorization: Bearer TODO_CF_API_TOKEN" \
  -H "Content-Type: application/json"
```

## 3) Runtime configuration values

Export these in your shell:

```bash
export CF_API_TOKEN="TODO_CF_API_TOKEN"
export CF_ACCOUNT_ID="TODO_CF_ACCOUNT_ID"
export CF_ZONE_ID="TODO_CF_ZONE_ID"
export DOMAIN="coach-royale.com"
export PAGES_PROJECT="coach-royale-web"
export WORKER_NAME="coachroyale-api"

export SUPABASE_URL="TODO_SUPABASE_URL"
export SUPABASE_ANON_KEY="TODO_SUPABASE_ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="TODO_SUPABASE_SERVICE_ROLE_KEY"

export RELAY_BASE_URL="https://TODO_RELAY_HOST"
export RELAY_SHARED_SECRET="TODO_RELAY_SHARED_SECRET"

export LEMONSQUEEZY_API_KEY="TODO_LS_API_KEY"
export LEMONSQUEEZY_STORE_ID="TODO_LS_STORE_ID"
export LEMONSQUEEZY_VARIANT_ID="TODO_LS_VARIANT_ID"
export LEMONSQUEEZY_WEBHOOK_SECRET="TODO_LS_WEBHOOK_SECRET"

# Optional (pro lane)
export ANTHROPIC_API_KEY="TODO_ANTHROPIC_API_KEY"
export WORKER_ANTHROPIC_MODEL="claude-sonnet-4-20250514"

# Worker defaults (adjust if needed)
export WORKER_ALLOWED_ORIGINS="https://coach-royale.com,https://www.coach-royale.com"
export WORKER_WORKERS_AI_MODEL="@cf/openai/gpt-oss-20b"
export WORKER_AI_GATEWAY_ID="coachroyale-free"
export WORKER_APP_BASE_URL="https://coach-royale.com"
```

Map Worker runtime vars expected by `apps/api-worker/scripts/worker-runtime-config.mjs`:

```bash
export WORKER_RELAY_BASE_URL="$RELAY_BASE_URL"
export WORKER_SUPABASE_URL="$SUPABASE_URL"
export WORKER_LEMONSQUEEZY_STORE_ID="$LEMONSQUEEZY_STORE_ID"
export WORKER_LEMONSQUEEZY_VARIANT_ID="$LEMONSQUEEZY_VARIANT_ID"
```

## 4) Supercell static-IP relay checks (VPS)

Required if Supercell allowlist is tied to the VPS egress IP.

- Confirm relay IP is allowlisted by Supercell.
- Confirm relay health endpoint responds.
- Confirm Worker-to-relay shared secret is configured.

```bash
curl -I "$RELAY_BASE_URL/health"
```

## 5) Install dependencies

```bash
cd $REPO_ROOT
npm ci --prefix apps/web
npm ci --prefix apps/api-worker
```

## 6) Configure Worker secrets and deploy Worker

```bash
cd $REPO_ROOT/apps/api-worker

export CLOUDFLARE_API_TOKEN="$CF_API_TOKEN"
export CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT_ID"

wrangler secret put RELAY_SHARED_SECRET <<< "$RELAY_SHARED_SECRET"
wrangler secret put SUPABASE_ANON_KEY <<< "$SUPABASE_ANON_KEY"
wrangler secret put SUPABASE_SERVICE_ROLE_KEY <<< "$SUPABASE_SERVICE_ROLE_KEY"
wrangler secret put LEMONSQUEEZY_API_KEY <<< "$LEMONSQUEEZY_API_KEY"
wrangler secret put LEMONSQUEEZY_WEBHOOK_SECRET <<< "$LEMONSQUEEZY_WEBHOOK_SECRET"

# Optional
if [ -n "${ANTHROPIC_API_KEY:-}" ]; then
  wrangler secret put ANTHROPIC_API_KEY <<< "$ANTHROPIC_API_KEY"
fi

npm run render:production-config
npm run verify:remote-secrets
wrangler deploy --config .wrangler/production.toml
```

## 7) Build and deploy Pages

```bash
cd $REPO_ROOT/apps/web
npm run build

wrangler pages project create "$PAGES_PROJECT" --production-branch main || true
wrangler pages deploy dist --project-name "$PAGES_PROJECT" --branch main
```

## 8) Set Pages runtime secrets/vars

```bash
wrangler pages secret put VITE_SUPABASE_URL --project-name "$PAGES_PROJECT" <<< "$SUPABASE_URL"
wrangler pages secret put VITE_SUPABASE_ANON_KEY --project-name "$PAGES_PROJECT" <<< "$SUPABASE_ANON_KEY"
wrangler pages secret put VITE_API_BASE_URL --project-name "$PAGES_PROJECT" <<< "https://$DOMAIN/api"
wrangler pages secret put VITE_AUTH_REDIRECT_URL --project-name "$PAGES_PROJECT" <<< "https://$DOMAIN"
```

## 9) Attach custom domain

```bash
wrangler pages domain add "$DOMAIN" --project-name "$PAGES_PROJECT" || true
wrangler pages domain add "www.$DOMAIN" --project-name "$PAGES_PROJECT" || true
```

## 10) Route `/api/*` to Worker on same domain

```bash
wrangler route add "$DOMAIN/api/*" "$WORKER_NAME" || true
wrangler route add "www.$DOMAIN/api/*" "$WORKER_NAME" || true
```

## 11) Validate production

```bash
curl -I "https://$DOMAIN"
curl -I "https://$DOMAIN/api/health"
curl -I "https://$DOMAIN/api/ready"
```

If `/api/ready` fails, check relay health + Worker secret set first.

## 12) One-command automation script

Use the included script:

```bash
cd $REPO_ROOT
chmod +x scripts/deploy-cloudflare-coach-royale.sh
./scripts/deploy-cloudflare-coach-royale.sh
```
