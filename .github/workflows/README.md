# CI/CD workflows

`ci.yml` validates the active monorepo apps and deploys the Cloudflare targets.

## What it does

- detects changes under `apps/web`, `apps/api-worker`, `apps/relay`, `supabase`, and `.github/workflows`
- validates:
  - `apps/web`: `format:check`, `lint`, `test`, `build`
  - `apps/api-worker`: `format:check`, `render:production-config`, `lint`, `test`, `deploy:dry-run` when Cloudflare credentials are available
  - `apps/relay`: `ruff check`, `pytest`
- deploys on pushes to `main` or `workflow_dispatch` after validation succeeds:
  - `apps/web` to Cloudflare Pages
  - `apps/api-worker` to Cloudflare Workers

Deployments are attached to GitHub environments so you can add required reviewers and treat them as approval gates.
Main-branch deploys are serialized: validation runs can still cancel superseded work on non-production refs, but production rollouts on `main` now queue instead of cancelling an in-flight deploy.

## Required GitHub environments

Create these environments in the repository settings:

- `production-web`
- `production-worker`

If you want manual approval before production deploys, add required reviewers to each environment.

## Required secrets and variables

Repository or environment secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `VITE_SUPABASE_ANON_KEY`

Repository or environment variables:

- `CLOUDFLARE_PAGES_PROJECT`
  - required for production web deploys
- `WEB_SMOKE_URL`
  - required; URL probed after the Pages deployment succeeds
- `VITE_SUPABASE_URL`
- `VITE_API_BASE_URL`
  - optional; leave unset to use the app default
- `VITE_AUTH_REDIRECT_URL`
  - optional; set when production OAuth needs an explicit callback origin

Worker production environment variables:

- `WORKER_ALLOWED_ORIGINS`
- `WORKER_ANTHROPIC_MODEL`
- `WORKER_RELAY_BASE_URL`
- `WORKER_SUPABASE_URL`
- `WORKER_LEMONSQUEEZY_STORE_ID`
- `WORKER_LEMONSQUEEZY_VARIANT_ID`
- `WORKER_SMOKE_URL`
  - required; should point to the deployed Worker health endpoint such as `/api/health`
- `WORKER_APP_BASE_URL`
  - optional

The production web deploy now fails fast if `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` is missing, or if either still uses the template placeholder value.
It also fails closed if `CLOUDFLARE_PAGES_PROJECT` or `WEB_SMOKE_URL` is unset.

The Worker pipeline now depends on the committed lockfile at `apps/api-worker/package-lock.json` and uses `npm ci` for validation and deploy jobs.
It also renders a production-specific Wrangler config from explicit `WORKER_*`
variables and fails closed if Cloudflare is missing any required Worker secrets
before deployment starts.
After deploy, the workflow probes the configured web and Worker smoke URLs and marks the deployment failed if either health check does not succeed.
Worker dry-run validation is only skipped on pull requests where deployment
credentials are intentionally unavailable; non-PR runs now fail closed if the
Cloudflare credentials required for dry-run validation are missing.

## Action pinning

The production workflow pins every third-party GitHub Action to an immutable commit SHA.
Each pin is annotated with the upstream major tag it is tracking in `ci.yml`.

When you intentionally refresh a pin:

- resolve the current tag SHA with `git ls-remote https://github.com/<owner>/<repo> refs/tags/<tag>`
- update the matching `uses:` line in `.github/workflows/ci.yml`
- keep the trailing `# vN` comment aligned with the tracked tag
- rerun the local workflow checks before commit

Current tracked tags:

- `actions/checkout` -> `v4`
- `actions/setup-node` -> `v4`
- `actions/setup-python` -> `v5`
- `dorny/paths-filter` -> `v3`

## Assumptions baked into the workflow

- Cloudflare runtime secrets for the worker are already managed in Cloudflare, not injected from GitHub Actions.
- The deploy workflow verifies the presence of these required Worker secrets in Cloudflare before deploy:
  - `RELAY_SHARED_SECRET`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `LEMONSQUEEZY_API_KEY`
  - `LEMONSQUEEZY_WEBHOOK_SECRET`
- `WEB_SMOKE_URL` should target a stable reachable app origin.
- `WORKER_SMOKE_URL` should target the Worker health route and return an HTTP `200`.
- The Pages project already exists.
- `main` is the production branch.
- Relay has validation only; no deploy step is defined because this repo does not contain a GitHub-hosted runner deploy path for that service.
