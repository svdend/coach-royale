#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WEB_DIR="$ROOT_DIR/apps/web"
WORKER_DIR="$ROOT_DIR/apps/api-worker"

DOMAIN="${DOMAIN:-coach-royale.com}"
PAGES_PROJECT="${PAGES_PROJECT:-coach-royale-web}"
WORKER_NAME="${WORKER_NAME:-coachroyale-api}"
ENABLE_WWW="${ENABLE_WWW:-1}"
RUN_INSTALL="${RUN_INSTALL:-1}"

log() {
  printf "\n[%s] %s\n" "deploy" "$1"
}

need_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required env var: $name" >&2
    return 1
  fi
}

put_worker_secret() {
  local name="$1"
  local value="${!name:-}"
  if [[ -z "$value" ]]; then
    echo "Missing worker secret value: $name" >&2
    return 1
  fi
  log "Setting worker secret: $name"
  printf "%s" "$value" | wrangler secret put "$name"
}

put_pages_secret() {
  local name="$1"
  local value="$2"
  if [[ -z "$value" ]]; then
    echo "Missing Pages secret value for: $name" >&2
    return 1
  fi
  log "Setting Pages secret: $name"
  printf "%s" "$value" | wrangler pages secret put "$name" --project-name "$PAGES_PROJECT"
}

need_cmd npm
need_cmd wrangler
need_cmd curl

log "Validating required env vars"
require_var CF_API_TOKEN
require_var CF_ACCOUNT_ID
require_var CF_ZONE_ID
require_var SUPABASE_URL
require_var SUPABASE_ANON_KEY
require_var SUPABASE_SERVICE_ROLE_KEY
require_var RELAY_BASE_URL
require_var RELAY_SHARED_SECRET
require_var LEMONSQUEEZY_API_KEY
require_var LEMONSQUEEZY_STORE_ID
require_var LEMONSQUEEZY_VARIANT_ID
require_var LEMONSQUEEZY_WEBHOOK_SECRET

export CLOUDFLARE_API_TOKEN="$CF_API_TOKEN"
export CLOUDFLARE_ACCOUNT_ID="$CF_ACCOUNT_ID"

export WORKER_ALLOWED_ORIGINS="${WORKER_ALLOWED_ORIGINS:-https://$DOMAIN,https://www.$DOMAIN}"
export WORKER_ANTHROPIC_MODEL="${WORKER_ANTHROPIC_MODEL:-claude-sonnet-4-20250514}"
export WORKER_WORKERS_AI_MODEL="${WORKER_WORKERS_AI_MODEL:-@cf/openai/gpt-oss-20b}"
export WORKER_AI_GATEWAY_ID="${WORKER_AI_GATEWAY_ID:-coachroyale-free}"
export WORKER_RELAY_BASE_URL="${WORKER_RELAY_BASE_URL:-$RELAY_BASE_URL}"
export WORKER_SUPABASE_URL="${WORKER_SUPABASE_URL:-$SUPABASE_URL}"
export WORKER_LEMONSQUEEZY_STORE_ID="${WORKER_LEMONSQUEEZY_STORE_ID:-$LEMONSQUEEZY_STORE_ID}"
export WORKER_LEMONSQUEEZY_VARIANT_ID="${WORKER_LEMONSQUEEZY_VARIANT_ID:-$LEMONSQUEEZY_VARIANT_ID}"
export WORKER_APP_BASE_URL="${WORKER_APP_BASE_URL:-https://$DOMAIN}"
export WORKER_STRUCTURED_LOGS_ENABLED="${WORKER_STRUCTURED_LOGS_ENABLED:-false}"

log "Checking relay health endpoint"
curl -fsSIL "$RELAY_BASE_URL/health" >/dev/null

if [[ "$RUN_INSTALL" == "1" ]]; then
  log "Installing dependencies"
  npm ci --prefix "$WEB_DIR"
  npm ci --prefix "$WORKER_DIR"
fi

log "Deploying Worker"
cd "$WORKER_DIR"
put_worker_secret RELAY_SHARED_SECRET
put_worker_secret SUPABASE_ANON_KEY
put_worker_secret SUPABASE_SERVICE_ROLE_KEY
put_worker_secret LEMONSQUEEZY_API_KEY
put_worker_secret LEMONSQUEEZY_WEBHOOK_SECRET

if [[ -n "${ANTHROPIC_API_KEY:-}" ]]; then
  put_worker_secret ANTHROPIC_API_KEY
else
  log "Skipping optional ANTHROPIC_API_KEY secret (not set)"
fi

npm run render:production-config
npm run verify:remote-secrets
wrangler deploy --config .wrangler/production.toml

log "Deploying Cloudflare Pages project"
cd "$WEB_DIR"
npm run build
wrangler pages project create "$PAGES_PROJECT" --production-branch main >/dev/null 2>&1 || true
wrangler pages deploy dist --project-name "$PAGES_PROJECT" --branch main

put_pages_secret VITE_SUPABASE_URL "$SUPABASE_URL"
put_pages_secret VITE_SUPABASE_ANON_KEY "$SUPABASE_ANON_KEY"
put_pages_secret VITE_API_BASE_URL "https://$DOMAIN/api"
put_pages_secret VITE_AUTH_REDIRECT_URL "https://$DOMAIN"

log "Binding custom domain(s) to Pages"
wrangler pages domain add "$DOMAIN" --project-name "$PAGES_PROJECT" >/dev/null 2>&1 || true
if [[ "$ENABLE_WWW" == "1" ]]; then
  wrangler pages domain add "www.$DOMAIN" --project-name "$PAGES_PROJECT" >/dev/null 2>&1 || true
fi

log "Adding Worker route(s) for API"
wrangler route add "$DOMAIN/api/*" "$WORKER_NAME" >/dev/null 2>&1 || true
if [[ "$ENABLE_WWW" == "1" ]]; then
  wrangler route add "www.$DOMAIN/api/*" "$WORKER_NAME" >/dev/null 2>&1 || true
fi

log "Running post-deploy checks"
curl -fsSIL "https://$DOMAIN" >/dev/null
curl -fsSIL "https://$DOMAIN/api/health" >/dev/null
curl -fsSIL "https://$DOMAIN/api/ready" >/dev/null

cat <<EOF

Deploy completed.
- Domain: https://$DOMAIN
- Pages project: $PAGES_PROJECT
- Worker: $WORKER_NAME

EOF
