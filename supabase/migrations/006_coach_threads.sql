-- Agentic coach chat: multi-turn conversation storage
--
-- Part of the Agentic Coach Chat epic (cr-9xm), specifically AG1 (cr-ji8).
-- Stores Pro-user agent conversations that are multi-turn and may include
-- tool-use history. Separate from analysis_history which is single-shot
-- coaching results. Populated by the forthcoming /api/coach/agent route.
--
-- RLS: strict user-id scoping on both tables. No tenant-wide reads.
-- Cascade deletes follow the same pattern as the rest of the schema so
-- GDPR account erasure (eraseUserData) removes conversation state along
-- with everything else.

CREATE TABLE IF NOT EXISTS public.coach_threads (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  player_tag text NOT NULL,
  title text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coach_threads_user_updated
  ON public.coach_threads (user_id, updated_at DESC);

ALTER TABLE public.coach_threads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own coach threads"
  ON public.coach_threads FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);


-- Individual messages within a thread. `content` is stored as jsonb so
-- Anthropic tool_use/tool_result content blocks can round-trip verbatim
-- without translation. `tool_calls` is a denormalized summary
-- (array of {name, input} objects) for cheap query/analytics without
-- parsing the full content blob.
CREATE TABLE IF NOT EXISTS public.coach_messages (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  thread_id uuid NOT NULL REFERENCES public.coach_threads (id) ON DELETE CASCADE,
  -- role matches Anthropic's message roles: user, assistant. Tool results
  -- are represented as user messages whose content contains tool_result
  -- blocks, consistent with the Anthropic API.
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content jsonb NOT NULL,
  tool_calls jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_coach_messages_thread_created
  ON public.coach_messages (thread_id, created_at ASC);

ALTER TABLE public.coach_messages ENABLE ROW LEVEL SECURITY;

-- Access to a message is gated on ownership of its parent thread.
-- Using a subquery keeps the policy simple and lets Postgres' join
-- planner handle it efficiently when combined with the thread index.
CREATE POLICY "Users can read own coach messages"
  ON public.coach_messages FOR SELECT
  USING (
    thread_id IN (
      SELECT id FROM public.coach_threads WHERE user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own coach messages"
  ON public.coach_messages FOR INSERT
  WITH CHECK (
    thread_id IN (
      SELECT id FROM public.coach_threads WHERE user_id = auth.uid()
    )
  );

-- No update/delete policies intentionally: messages are immutable once
-- written. Thread deletion cascades to messages, which is the only
-- supported removal path.


-- Auto-update coach_threads.updated_at when a child message is
-- inserted, so "recently active threads" queries can sort purely
-- on the parent table without joining messages.
CREATE OR REPLACE FUNCTION public.touch_coach_thread_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.coach_threads
    SET updated_at = now()
    WHERE id = NEW.thread_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER coach_messages_touch_thread
  AFTER INSERT ON public.coach_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_coach_thread_updated_at();
