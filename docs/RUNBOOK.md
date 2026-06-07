# Operational Runbooks

## Runbook: Workers AI free-lane upsell spike

**Owner:** CoachRoyale alpha operator | **Frequency:** As needed
**Last Updated:** 2026-04-24 | **Last Run:** N/A

### Purpose

Use this runbook when authenticated free users suddenly see more upgrade
prompts on the free managed-AI surfaces. In this alpha, the free Workers AI
lane is intentionally bounded and may return a normal HTTP 200 response with an
`upsell` object instead of model text.

Free-lane surfaces in scope:

- `GET /api/player/:tag/analytics` (deterministic `player_state` only)
- `POST /api/analysis` (managed AI deep analysis; JSON body `{ "tag": "..." }`)
- `POST /api/ai/respond`

Out of scope for this runbook:

- Anonymous users, who should receive deterministic preview responses.
- Pro users, who should use Anthropic and may see `coaching_unavailable` if the
  Pro lane is unhealthy.
- `/api/coach/weekly-plan/:tag` and `/api/coach/question/:tag`, which remain
  Pro-only in this phase.

### Symptoms

- Users report repeated "Upgrade to Pro" or "shared free AI pool is busy"
  prompts on analysis or quick-response flows.
- API responses include `upsell.reason = "daily_limit"` for many users.
- API responses include `upsell.reason = "pool_exhausted"` after Workers AI or
  AI Gateway returns rate-limit or capacity errors.
- Cloudflare AI Gateway request volume, 429s, or blocked requests jump for the
  free lane.
- Analytics Engine shows a spike in `upsell_triggered` events for tier `free`.
- Supabase `free_ai_usage` rows show many users at or above the daily cap.

Expected upsell response shape:

```json
{
  "text": null,
  "upsell": {
    "reason": "daily_limit",
    "cta": "Upgrade to Pro for unlimited coaching.",
    "upgrade_url": "https://..."
  }
}
```

`reason` can be `daily_limit` or `pool_exhausted`.

### Production Resources And Env Vars To Verify

- Cloudflare AI Gateway: `coachroyale-free`
- Worker runtime var: `AI_GATEWAY_ID=coachroyale-free`
- Production config input: `WORKER_AI_GATEWAY_ID=coachroyale-free`
- Workers AI model var: `WORKERS_AI_MODEL=@cf/openai/gpt-oss-20b`
- Production model input: `WORKER_WORKERS_AI_MODEL=@cf/openai/gpt-oss-20b`
- Analytics Engine binding: `AI_EVENTS`
- Analytics Engine dataset: `coachroyale_ai_events`
- Production analytics input: `WORKER_AI_EVENTS_DATASET=coachroyale_ai_events`
  or omitted only if the renderer default is still `coachroyale_ai_events`
- Workers AI cost guardrail: Cloudflare Workers AI budget alert
- Supabase migration: `supabase/migrations/004_add_free_ai_usage.sql`
- Supabase table: `public.free_ai_usage`
- Supabase RPC: `public.increment_free_ai_usage(uuid, date)`
- Supabase env needed by Worker: `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY`

### First Triage

1. Confirm whether the spike is real user impact or expected cap behavior.
   Check one affected browser request and record the endpoint, authenticated
   user tier, HTTP status, and `upsell.reason`.
2. Separate the reasons. `daily_limit` points to Supabase per-user counters;
   `pool_exhausted` points to AI Gateway, Workers AI capacity, or Gateway
   rate-limit settings.
3. Confirm Pro is not affected. If Pro users see `coaching_unavailable`, treat
   that as a separate Anthropic/pro-lane incident.
4. Confirm the deployed Worker still has the expected production env and
   bindings listed above.
5. Check the Workers AI budget alert before raising any free-lane limits.

### Cloudflare AI Gateway Checks

Open Cloudflare dashboard for the production account and inspect AI Gateway
`coachroyale-free`.

Check:

- Gateway exists and the Worker is sending traffic through
  `AI_GATEWAY_ID=coachroyale-free`.
- Request count and 429/block rate over the last 15 minutes, 1 hour, and 24
  hours.
- Rate-limit rules or quota settings that could be lower than expected.
- Gateway logs tagged with `coachroyale:free`.
- Workers AI provider errors, high latency, or response-size anomalies.
- Whether the Workers AI budget alert fired or is close to firing.

Interpretation:

- Many 429s with `upsell.reason = "pool_exhausted"` means the shared free pool
  or Gateway rule is constraining traffic.
- Normal Gateway volume with many `daily_limit` upsells means user-level daily
  accounting is working and the spike is likely product usage, abuse, or a
  cap-size issue.
- No Gateway traffic but many free-lane requests means routing or binding is
  broken; verify `AI_GATEWAY_ID`, the `AI` binding, and the deployed Worker
  version.

### Analytics Engine Checks

Open Cloudflare Analytics Engine and query dataset
`coachroyale_ai_events`.

Current Worker event mapping:

- `index1`: endpoint, for example `analyze` or `respond`
- `index2`: tier, for example `free` or `pro`
- `index3`: provider, for example `workers_ai` or `anthropic`
- `blob1`: model
- `blob2`: hashed user id
- `blob3`: upsell reason, or `none`
- `double1`: prompt characters
- `double2`: response characters
- `double3`: upsell triggered, `1` or `0`
- `double4`: latency in milliseconds

Useful checks:

```sql
select
  index1 as endpoint,
  blob3 as upsell_reason,
  count() as events,
  sum(double3) as upsells
from coachroyale_ai_events
where timestamp >= now() - interval '1 hour'
  and index2 = 'free'
group by endpoint, upsell_reason
order by upsells desc;
```

```sql
select
  blob2 as user_hash,
  count() as events,
  sum(double3) as upsells
from coachroyale_ai_events
where timestamp >= now() - interval '1 hour'
  and index2 = 'free'
group by user_hash
order by events desc
limit 25;
```

If `AI_EVENTS` has no recent rows while the app is serving free-lane traffic,
the user-facing flow may still work, but observability is degraded. Verify the
`AI_EVENTS` binding and `WORKER_AI_EVENTS_DATASET`.

### Supabase Usage-Counter Checks

In the production Supabase SQL editor, verify migration
`004_add_free_ai_usage.sql` has been applied and the RPC exists.

```sql
select to_regclass('public.free_ai_usage') as free_ai_usage_table;
```

```sql
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'increment_free_ai_usage';
```

Check aggregate usage:

```sql
select
  usage_date,
  count(*) as users,
  sum("count") as total_calls,
  max("count") as max_user_calls
from public.free_ai_usage
where usage_date >= current_date - interval '7 days'
group by usage_date
order by usage_date desc;
```

Check today's heaviest users:

```sql
select
  user_id,
  "count"
from public.free_ai_usage
where usage_date = current_date
order by "count" desc
limit 25;
```

Interpretation:

- Many users at `count >= 30` means the per-user daily cap is driving
  `daily_limit` upsells.
- One or a few users far above normal traffic may indicate abuse, repeated
  retries, or a client loop.
- No rows for today while free users are hitting AI endpoints means the Worker
  cannot write counters or is not reaching Supabase with service-role access.

### Immediate Mitigations

- If `pool_exhausted` dominates and the Workers AI budget alert is healthy,
  temporarily raise or relax the `coachroyale-free` AI Gateway limit. Keep the
  change small and time-boxed because this is an alpha budget guardrail.
- If the Workers AI budget alert fired or spend is unclear, do not raise limits.
  Keep or tighten the Gateway limit and let the product return the
  `pool_exhausted` upsell while the spike is investigated.
- If `daily_limit` dominates, do not reset counters globally. For alpha, treat
  the 30/day cap as working unless there is a confirmed bug or internal test
  account impact.
- If a single user or automation is causing a spike, block or throttle at the
  edge/Gateway if available. Avoid direct database edits unless there is a clear
  operational reason and the user id is confirmed.
- If Analytics Engine is down but user traffic is healthy, continue serving
  traffic and open a follow-up issue; telemetry failure should not block
  coaching responses.
- If Supabase counter writes are failing, expect free-lane requests to error or
  mis-account. Prefer rollback to the last known-good Worker deployment over
  manual database surgery.

### Rollback And Safe Mode

Rollback path:

- Roll back the Cloudflare Worker to the previous known-good production
  deployment if the spike started immediately after a deploy.
- Verify the rolled-back deployment still has `AI_GATEWAY_ID`,
  `WORKERS_AI_MODEL`, `AI_EVENTS`, `SUPABASE_URL`, and
  `SUPABASE_SERVICE_ROLE_KEY` configured correctly.
- Do not roll back Supabase migration `004_add_free_ai_usage.sql` during an
  incident. The table is additive and rollback risks losing visibility into
  usage.

Safe mode:

- For spend protection, set the AI Gateway `coachroyale-free` limit very low or
  block free-lane traffic at the Gateway. The Worker should convert resulting
  429-style failures into `upsell.reason = "pool_exhausted"`.
- Leave Pro routes untouched. Pro weekly plan and coach question routes are
  Pro-only and should not depend on the free Workers AI pool.
- Restore normal Gateway limits only after the Workers AI budget alert,
  Gateway 429 rate, and Analytics Engine upsell rate are back to expected
  alpha levels.

### Escalation

Escalate when:

- The Workers AI budget alert has fired or projected spend is unknown.
- `pool_exhausted` persists after Gateway limits are verified.
- Supabase `increment_free_ai_usage` is missing, failing, or returning invalid
  counts in production.
- Free-lane upsells are affecting Pro users or Pro-only routes.
- A rollback does not restore expected behavior within 15 minutes.

Escalation targets:

- Cloudflare account owner for AI Gateway, Workers AI, Analytics Engine, and
  budget-alert changes.
- Supabase project owner for migration, RPC, service-role, and
  `free_ai_usage` issues.
- Product/alpha owner for decisions to raise caps, preserve strict safe mode,
  or message alpha users about free-lane limits.

### Post-Incident Follow-Up

- Record the dominant reason: `daily_limit`, `pool_exhausted`, config error, or
  telemetry gap.
- Save the before/after AI Gateway 429 rate and Analytics Engine upsell rate.
- Decide whether the 30/day free cap, Gateway pool size, or UI copy should
  change before broader rollout.
- Add a regression test or deployment check if the incident involved missing
  `AI_GATEWAY_ID`, `AI_EVENTS`, or Supabase RPC configuration.
