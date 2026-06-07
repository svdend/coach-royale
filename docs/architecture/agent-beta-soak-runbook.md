# Agentic Coach Chat — Pro Beta Soak Runbook (AG7)

This runbook covers the 30-day soak that AG7 (`cr-gh7`) gates on before
the feature graduates from "beta opt-in" to a default-on experience
for Pro users.

Code shipped: per-user `coach_agent_beta_opt_in` flag (profile column),
`/api/coach/agent-beta` GET + PUT endpoints, route guard on
`/api/coach/agent/:tag`, UI toggle in `CoachChat.tsx`.

Code NOT in scope of AG7: "auto-enroll all Pro users" rollout. That is
a follow-up once the soak clears.

---

## Prerequisites

Before you flip anything on:

- [ ] Supabase migration `007_coach_agent_beta.sql` applied to production
      (`supabase db push` or your migration pipeline)
- [ ] Supabase migration `006_coach_threads.sql` applied (required by AG4)
- [ ] `ANTHROPIC_API_KEY` set as a Worker secret
- [ ] `VITE_COACH_AGENT_ENABLED=true` set in the web build env on the
      deploy you want to test against (staging first is ideal)
- [ ] You've run `npm run eval:agent --prefix apps/api-worker` at least
      once against the production Anthropic model and eyeballed the
      report. No need to block on quality metrics here — that's what
      the soak is for.

---

## Starting the soak

### Day 0

1. Deploy the Worker + web with `VITE_COACH_AGENT_ENABLED=true`.
2. Your own account: sign in, go to CoachChat, click "Enable beta".
   Verify a streaming turn works end-to-end (ask "how am I doing?").
3. Announce to 5–10 trusted beta Pro users. Don't auto-enroll — they
   click the toggle. This is intentional: opt-in engagement correlates
   with forgiveness for rough edges.
4. Record start date. Soak runs 30 calendar days.

### Invite template

> We're testing a new coach experience for Pro users. It can look at
> your actual recent battles and decks while answering. It's slower
> than the current coach (5–15s typical). If you'd like to try it,
> open the coach chat — there's an "Enable beta" button. You can
> turn it off anytime.

---

## What to watch, weekly

Run these Analytics Engine queries on a fixed day each week.

### 1. Per-turn success rate

```sql
SELECT
  index3 AS status,  -- "ok" or "error"
  COUNT(*) AS turns,
  SUM(double1) / COUNT(*) AS mean_latency_ms
FROM coachroyale_ai_events
WHERE index1 = 'coach_agent_turn'
  AND timestamp > now() - interval '7 days'
GROUP BY status
```

- **Success bar**: ≥95% of turns end with `status=ok`.
- **Latency ceiling**: p95 under 20s feels OK for a coaching chat. Over
  30s and users bounce.

### 2. Tool-call volume and error rate

```sql
SELECT
  index3 AS tool_name,
  COUNT(*) AS calls,
  SUM(double3) / COUNT(*) AS error_rate,
  SUM(double1) / COUNT(*) AS mean_latency_ms
FROM coachroyale_ai_events
WHERE index1 = 'coach_agent_tool'
  AND timestamp > now() - interval '7 days'
GROUP BY tool_name
ORDER BY calls DESC
```

- **Success bar**: any single tool with >10% error rate needs
  investigation. Most likely candidates: Supabase is throttling, or
  `get_clan_info` is being called for clanless players and returning
  empty objects the agent then handles badly.

### 3. Active beta users

```sql
SELECT COUNT(DISTINCT blob2) AS distinct_users
FROM coachroyale_ai_events
WHERE index1 = 'coach_agent_turn'
  AND timestamp > now() - interval '7 days'
```

- **Minimum bar for a meaningful soak**: ≥10 distinct users by week 2,
  ≥20 by week 4. If you're under, the opt-in invitation isn't
  discoverable enough — consider an in-app announcement rather than
  pushing to GA.

### 4. Opt-outs

```sql
-- Hacky but effective: count `setCoachAgentBetaOptIn(false)` calls
-- via the Worker's access log or your API gateway. Not currently
-- instrumented in AE — file a follow-up to add it if the soak reveals
-- high churn.
```

---

## Cost budget

Each beta turn costs roughly:

- **1× outer Claude call** (system + tools schema + user message + tool
  results) — typically 2–5k input tokens, 300–500 output tokens
- **0–5× inner tool calls**, zero marginal LLM cost
- **Per-turn ballpark**: $0.02–0.05 at Sonnet prices

With 20 active users × 5 turns/day × 30 days = 3,000 turns = **~$75–150
total for the soak**. If your tokens blow way past this, the agent is
probably calling tools it doesn't need on every turn. Investigate.

---

## Sentry watchlist

New error patterns to watch that indicate real problems (not noise):

- `AiProviderUnavailableError("anthropic")` coming from
  `/api/coach/agent/:tag` — Anthropic outage or key revocation.
- `error.message.includes("coach_messages")` — migration 006 failed or
  RLS policy is rejecting writes.
- `DOMException("aborted")` from the endpoint — users giving up. A
  low background rate is normal; a spike means latency got bad.

---

## Go / No-go decision at day 30

Write a short markdown doc (`docs/architecture/agent-beta-soak-results.md`)
answering:

1. **Success rate**: what was the median and p95 across the 30 days?
2. **Cost per Pro user per week**: did 20 active users cost under $50?
3. **User feedback**: any direct reports? Any opt-outs with reasons?
4. **Quality vs baseline**: does the eval harness (AG6) say the agent
   still beats single-shot on the fixture set? Run `npm run eval:agent`
   again with `EVAL_USE_JUDGE=true` and compare to a baseline run from
   day 0.
5. **Decision**: promote to default-on, hold at opt-in, or roll back.

Write the doc before making the change. It forces you to look at the
data instead of just "it feels good."

---

## Rolling back

If you need to pull the rip cord during the soak:

**Immediate kill switch** (no code deploy):
- Unset `VITE_COACH_AGENT_ENABLED` on the next web build. UI stops
  offering the beta for new sessions; existing sessions that loaded
  with it are still using it until they refresh.

**Full rollback**:
```sql
-- Clears everyone's opt-in status. Next page load, the UI shows the
-- invitation again; until then, server-side guard rejects their
-- requests with 403 forbidden_beta_optin_required.
UPDATE profiles SET coach_agent_beta_opt_in = FALSE;
```

**Nuclear**:
- Merge a revert PR for AG7 + AG5 (removes the endpoint + UI entirely).
- AG1 (coach_threads tables) can stay — they're empty and cost
  nothing; keeping them avoids a re-migration if you come back.

---

## After success: promoting to default-on

Not in scope of AG7. File a follow-up (`AG8`?) that:

1. Adds a server-side default of `coach_agent_beta_opt_in = true`
   for new Pro users (migration 008, altering the column default).
2. Adds a one-time migration to flip existing Pro users to opted-in.
3. Updates the UI to treat the master flag as "always on for Pro".
4. Removes the "Enable beta" invitation from CoachChat.

Don't do any of those during the soak. Their whole premise is that
the soak already cleared.
