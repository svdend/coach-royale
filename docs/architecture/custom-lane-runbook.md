# 4th AI Lane — Garage Ollama Runbook (Phase 1)

This runbook stands up the self-hosted fine-tuned model lane gated to the
operator only. The code shipped in P1.1–P1.5 already handles everything
on the Worker side; this document covers the garage-side infrastructure.

**Target architecture:**

```
Cloudflare Worker (edge)
      |
      |  HTTPS, Bearer token, X-Custom-Model-Auth header
      v
https://garage-host.tailnet-name.ts.net          <-- Tailscale Funnel (public)
      |
      v
Caddy on garage-host :11435                      <-- shared-secret gate
      |  X-Custom-Model-Auth verified
      v
Ollama on garage-host :11434                     <-- OpenAI-compatible /v1
      |
      v
Loaded fine-tuned model in VRAM
```

Why this shape: Cloudflare Workers cannot join a Tailscale network — they
run on Cloudflare's edge, not on a machine where Tailscale can be
installed. Tailscale Funnel is the simplest bridge. Caddy in front of
Ollama enforces a shared secret because Ollama itself has no
authentication.

---

## Prerequisites

- [ ] Tailscale installed and authed on the garage GPU host
- [ ] Tailnet has Funnel enabled (Admin Console → DNS → HTTPS Certificates
      → Enable, then → Funnel → Enable)
- [ ] The garage host has a magic DNS name you can read from
      `tailscale status --json | jq -r '.Self.DNSName'` (e.g.
      `garage-box.tailnet-name.ts.net.`). Strip the trailing dot.
- [ ] Ollama installed and able to run the fine-tuned model at least once
      (`ollama run <model-tag>` returns text)

---

## Step 1 — Pull or register the model in Ollama

If the fine-tune is a GGUF file, register it with a Modelfile. Example
`Modelfile`:

```
FROM ./coachroyale-qwen2.5-14b-ft-v1.Q5_K_M.gguf
TEMPLATE """{{ if .System }}<|im_start|>system
{{ .System }}<|im_end|>
{{ end }}{{ if .Prompt }}<|im_start|>user
{{ .Prompt }}<|im_end|>
{{ end }}<|im_start|>assistant
{{ .Response }}<|im_end|>
"""
PARAMETER stop "<|im_end|>"
PARAMETER num_ctx 8192
```

Then:

```bash
ollama create coachroyale-ft-v1 -f Modelfile
ollama run coachroyale-ft-v1 "Hello, how do I counter X.Bow?"
```

Note the exact model tag — this becomes `WORKER_CUSTOM_MODEL_NAME`.

**Keep the model resident in VRAM** so the first request isn't a 30s cold
start:

```bash
# /etc/systemd/system/ollama.service (override with systemctl edit ollama)
Environment="OLLAMA_KEEP_ALIVE=24h"
Environment="OLLAMA_HOST=127.0.0.1:11434"
Environment="OLLAMA_NUM_PARALLEL=1"
```

`OLLAMA_NUM_PARALLEL=1` is the right default for a 4090/3090 running a
13–14B model. Raise only if you verify you have the VRAM headroom.

---

## Step 2 — Caddy gate in front of Ollama

Install Caddy on the garage host. Write `/etc/caddy/Caddyfile`:

```caddy
:11435 {
    # Synthesized health endpoint the Worker can poll cheaply.
    handle /healthz {
        reverse_proxy 127.0.0.1:11434 {
            rewrite /api/tags
            health_uri /api/tags
            health_interval 10s
        }
    }

    # Everything else requires the shared secret.
    handle {
        @authorized header X-Custom-Model-Auth REPLACE_WITH_SHARED_SECRET
        handle @authorized {
            reverse_proxy 127.0.0.1:11434 {
                # Ollama's cold-start + long generations exceed the default.
                transport http {
                    read_timeout 120s
                }
            }
        }
        respond "Unauthorized" 401
    }
}
```

Replace `REPLACE_WITH_SHARED_SECRET` with a long random string. You will
upload the same value to Cloudflare as the `CUSTOM_MODEL_SHARED_SECRET`
Worker secret. Rotate both together.

Reload:

```bash
sudo systemctl reload caddy
curl -sS http://127.0.0.1:11435/healthz          # expect 200
curl -sS http://127.0.0.1:11435/v1/models        # expect 401
curl -sS -H "X-Custom-Model-Auth: REPLACE_WITH_SHARED_SECRET" \
     http://127.0.0.1:11435/v1/models            # expect 200 JSON
```

Three negative tests before you expose anything to the internet.

---

## Step 3 — Tailscale Funnel

Expose port 11435 (Caddy), NOT 11434 (Ollama). Never expose raw Ollama.

```bash
sudo tailscale funnel --bg 11435
sudo tailscale funnel status
```

Note the URL in the status output (e.g.
`https://garage-box.tailnet-name.ts.net`). This becomes the `CUSTOM_MODEL_URL`
with `/v1` appended.

Smoke test from a laptop that is NOT on your tailnet:

```bash
# From any random network
curl -sS https://garage-box.tailnet-name.ts.net/healthz
# expect 200

curl -sS https://garage-box.tailnet-name.ts.net/v1/models
# expect 401

curl -sS -H "X-Custom-Model-Auth: REPLACE_WITH_SHARED_SECRET" \
     -H "Authorization: Bearer unused" \
     https://garage-box.tailnet-name.ts.net/v1/chat/completions \
     -H "content-type: application/json" \
     -d '{"model":"coachroyale-ft-v1","messages":[{"role":"user","content":"ping"}],"max_tokens":20}'
# expect 200 OpenAI-style response
```

If the third request succeeds, the Worker will be able to call this too.

---

## Step 4 — Configure the Worker

Get your Supabase user id for the operator account:

```sql
-- In Supabase SQL editor while logged in as the operator account
select auth.uid();
```

Set the following in the **production-worker** GitHub environment
(non-secret vars):

| Variable                        | Value                                                             |
| ------------------------------- | ----------------------------------------------------------------- |
| `WORKER_CUSTOM_MODEL_URL`       | `https://garage-box.tailnet-name.ts.net/v1`                       |
| `WORKER_CUSTOM_MODEL_NAME`      | `coachroyale-ft-v1` (or whatever ollama tag you created)          |
| `WORKER_OPERATOR_USER_IDS`      | your Supabase user UUID (comma-separate if you add more later)    |

Set the following as Cloudflare **Worker secrets**
(`npx wrangler secret put <NAME> --name coachroyale-api`):

| Secret                         | Value                                                                 |
| ------------------------------ | --------------------------------------------------------------------- |
| `CUSTOM_MODEL_KEY`             | `unused` (Ollama ignores it, but the code requires any non-empty string) |
| `CUSTOM_MODEL_SHARED_SECRET`   | the same long random string you put in the Caddyfile                  |

Deploy:

```bash
cd apps/api-worker
npm run render:production-config
npm run verify:remote-secrets
npx wrangler deploy
```

The `verify:remote-secrets` script will warn that `CUSTOM_MODEL_KEY` and
`CUSTOM_MODEL_SHARED_SECRET` are optional — that's fine. It will succeed
if all required secrets are present.

---

## Step 5 — End-to-end smoke test

Sign in to the app as the operator account (the UUID you set in
`WORKER_OPERATOR_USER_IDS`). Run a Quick Analysis. Then query
Analytics Engine:

```sql
-- Cloudflare AE query console
SELECT
  index1 AS endpoint,
  index2 AS tier,
  index3 AS provider,
  blob4 AS fallback_status,
  blob5 AS original_provider,
  double5 AS fallback_used_numeric,
  double4 AS latency_ms
FROM coachroyale_ai_events
WHERE timestamp > now() - interval '10 minutes'
ORDER BY timestamp DESC
```

Expected: `original_provider=custom` and (assuming the garage responded)
`provider=custom`, `fallback_status=direct`, `fallback_used_numeric=0`.

If you see `provider=anthropic` with `original_provider=custom` and
`fallback_status=fallback`, the Worker reached the router but the
garage endpoint failed. Check Caddy logs
(`journalctl -u caddy -f`) and the Worker's Sentry issues.

---

## Step 6 — Ongoing operation (soak period)

During the 30-day soak (`cr-0hb`):

**Weekly checks:**

```sql
-- Fallback rate for custom lane over last 7 days
SELECT
  COUNT(*) AS total_operator_requests,
  SUM(double5) AS fallback_count,
  SUM(double5) * 100.0 / COUNT(*) AS fallback_pct
FROM coachroyale_ai_events
WHERE blob5 = 'custom'  -- original_provider
  AND timestamp > now() - interval '7 days'
```

Success criteria: `fallback_pct < 10`.

**Latency watch:**

```sql
SELECT
  quantile(double4, 0.5) AS p50_ms,
  quantile(double4, 0.95) AS p95_ms,
  quantile(double4, 0.99) AS p99_ms
FROM coachroyale_ai_events
WHERE index3 = 'custom'
  AND timestamp > now() - interval '7 days'
```

Benchmark against Anthropic for the same user/endpoint in the same
window. If custom p95 is >3× Anthropic p95, investigate (cold starts,
thermal throttling, model size).

**Ollama housekeeping:**

```bash
# Check VRAM and GPU utilization
nvidia-smi

# Check Ollama is still holding the model resident
ollama ps

# Verify Caddy and Funnel are up
systemctl status caddy
tailscale funnel status
```

---

## Failure modes and runbook

### Worker returns 500 on operator requests

1. Check Cloudflare Worker logs (`wrangler tail --name coachroyale-api`).
2. If you see `AiProviderUnavailableError("anthropic")`, both custom and
   Anthropic failed. Check `ANTHROPIC_API_KEY` first.
3. If custom is silently falling back, check Caddy logs for 401s (wrong
   shared secret) or upstream errors (Ollama down, OOM).

### Ollama OOMs on the fine-tuned model

- Reduce `num_ctx` in the Modelfile.
- Switch to a lower quantization (Q4_K_M instead of Q5_K_M).
- Set `OLLAMA_NUM_PARALLEL=1` if not already.

### Tailscale Funnel rate limits

Tailscale Funnel has per-tailnet request limits (check the Admin
Console). If you start hitting them, migrate to Cloudflare Tunnel
(Option B in the original design doc — no code change needed on the
Worker side, just new public URL).

### Garage box power/network outage

Expected — this is the core risk of the self-hosted lane. The Worker's
silent fallback to Anthropic means operator requests still succeed
during an outage. Check the `fallback_pct` query weekly; sustained high
rates mean the lane is unreliable enough to stop Phase 2 promotion.

### Rotating the shared secret

1. Generate a new long random string.
2. Update the Caddyfile with the new value. `sudo systemctl reload caddy`.
3. Update the Worker secret: `npx wrangler secret put CUSTOM_MODEL_SHARED_SECRET --name coachroyale-api`.
4. Worker picks up the new secret on next request. No Worker redeploy
   needed, but you can `npx wrangler deploy` to force it.
5. Rotate at least quarterly (matches the existing `RELAY_SHARED_SECRET`
   cadence in SECRETS.md).

---

## Decommissioning

If Phase 1 soak results in a no-go decision:

1. Remove `WORKER_OPERATOR_USER_IDS` from the worker config → the router
   immediately stops selecting the custom lane for everyone.
2. Optional: remove `WORKER_CUSTOM_MODEL_URL/NAME` and the
   `CUSTOM_MODEL_*` secrets. The `customLaneConfigured()` gate will
   return false and the branch will never fire even if
   `OPERATOR_USER_IDS` is restored.
3. `sudo tailscale funnel --off 11435` to take the endpoint offline.
4. The Worker code remains — it's dormant until re-configured.
