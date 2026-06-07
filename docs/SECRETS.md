# Secrets Runbook

This repo must not contain live credentials. Store deploy-time values in the
target platform and keep local developer values in untracked files or shell
sessions.

## Scan Commands

- Required local/CI scanner: `npm run secret:scan`
- Optional gitleaks parity check: `gitleaks detect --config .gitleaks.toml --redact`

The repo-local scanner checks tracked files only, which keeps local generated or
ignored artifacts out of the result. CI runs the same command on every workflow.

## Secret Inventory

| Secret                                         | Storage location                                     | Rotation owner | Notes                                                                                |
| ---------------------------------------------- | ---------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------ |
| `CLOUDFLARE_API_TOKEN`                         | GitHub environment secret                            | Platform owner | Must be scoped to Pages/Workers deploys only.                                        |
| `CLOUDFLARE_ACCOUNT_ID`                        | GitHub environment secret                            | Platform owner | Treat as sensitive deployment metadata.                                              |
| `RELAY_SHARED_SECRET`                          | Cloudflare Worker secret and relay runtime env       | Platform owner | Rotating requires updating both Worker and VPS relay.                                |
| `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY` | GitHub/Cloudflare secret or public build-time var    | App owner      | Public anon key is not a service credential, but still avoid hardcoding live values. |
| `SUPABASE_SERVICE_ROLE_KEY`                    | Cloudflare Worker secret only                        | Data owner     | Never expose to browser, CI logs, or Pages builds.                                   |
| `LEMONSQUEEZY_API_KEY`                         | Cloudflare Worker secret                             | Billing owner  | Used only by checkout creation.                                                      |
| `LEMONSQUEEZY_WEBHOOK_SECRET`                  | Cloudflare Worker secret and Lemon Squeezy dashboard | Billing owner  | Rotate with webhook endpoint verification.                                           |
| `ANTHROPIC_API_KEY`                            | Cloudflare Worker secret                             | AI owner       | Pro managed lane only.                                                               |
| `SUPERCELL_API_TOKEN`                          | VPS relay secret only                                | Platform owner | Must stay on the static-IP relay host.                                               |
| `CUSTOM_MODEL_KEY`                             | Cloudflare Worker secret (optional)                  | AI owner       | Bearer token for the self-hosted fine-tuned model lane (Phase 1 operator-only). Worker no-ops the custom lane if unset, and the router falls back to Anthropic. |
| `CUSTOM_MODEL_SHARED_SECRET`                   | Cloudflare Worker secret and garage host env         | AI owner       | Extra origin check (`X-Custom-Model-Auth`) so the endpoint rejects traffic even if the URL leaks. Rotate with garage host redeploy. |

Non-secret custom-lane routing config (`CUSTOM_MODEL_URL`, `CUSTOM_MODEL_NAME`,
`OPERATOR_USER_IDS`) lives in the Worker `[vars]` block and is set through the
`WORKER_CUSTOM_MODEL_URL`, `WORKER_CUSTOM_MODEL_NAME`, and
`WORKER_OPERATOR_USER_IDS` GitHub environment variables. These are not secrets
but should be treated as deployment metadata.

BYOK provider keys are user-owned browser-local values. They must not be logged,
sent to the Worker, stored in Supabase, or included in support exports.

## Rotation Triggers

Rotate immediately when any of these happen:

- a credential appears in git history, issue trackers, logs, screenshots, chat,
  or build artifacts
- a team member or automation token with access leaves the project
- a vendor dashboard reports suspicious access or billing anomalies
- the VPS relay host is rebuilt, snapshotted, or suspected compromised
- a GitHub Actions, Cloudflare, Supabase, Lemon Squeezy, Anthropic, or Supercell
  token scope changes

For alpha, also rotate `RELAY_SHARED_SECRET`, service-role keys, and provider API
keys at least quarterly.

## Emergency Response

1. Disable or revoke the exposed credential in the source platform.
2. Create a replacement with the narrowest scope that still supports deploy or
   runtime behavior.
3. Update the platform secret store: GitHub environment secret, Cloudflare
   Worker secret, Supabase dashboard, Lemon Squeezy webhook config, or VPS env.
4. Redeploy affected runtimes and smoke-check `/api/health`, checkout creation,
   and one Supabase-authenticated user-scoped route.
5. Run `npm run secret:scan` locally and in CI.
6. If the value reached git history, assume compromise; rotate first, then clean
   history only after confirming all consumers have moved to the new value.

## Preventive Rules

- Do not commit `.env`, rendered `.wrangler/production.toml`, service-role keys,
  Cloudflare tokens, Supercell tokens, provider keys, or exported dashboard
  configs containing secrets.
- Do not print secrets in CI. Use platform masking and avoid `set -x`.
- Prefer GitHub environment secrets for deploy credentials and Cloudflare Worker
  secrets for runtime credentials.
- Use GitHub environment protection rules before production deploys.
- Keep the Supercell API token isolated to the VPS relay because it depends on a
  static IP allowlist.
