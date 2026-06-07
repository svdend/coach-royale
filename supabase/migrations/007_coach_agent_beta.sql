-- Agentic coach chat Pro beta opt-in (AG7, cr-gh7)
--
-- Adds a per-user flag so Pro users can opt into the experimental
-- agentic coach chat. The /api/coach/agent endpoint will reject
-- requests from Pro users who haven't flipped this to true, even
-- when the master VITE_COACH_AGENT_ENABLED flag is on.
--
-- Default FALSE. RLS already restricts profile reads/writes to the
-- owning user, so the column inherits the correct access control
-- without new policies.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS coach_agent_beta_opt_in boolean NOT NULL DEFAULT FALSE;

-- Narrow helper index: most reads are "fetch one profile by id and
-- check the flag", which is already covered by the primary key. No
-- additional index is needed. Leaving a comment here so future
-- reviewers don't add one reflexively.
