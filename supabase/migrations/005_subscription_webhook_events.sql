-- Idempotent Lemon Squeezy (and future provider) webhook audit + dedup
CREATE TABLE IF NOT EXISTS public.subscription_webhook_events (
  id uuid DEFAULT uuid_generate_v4() PRIMARY KEY,
  idempotency_key text NOT NULL UNIQUE,
  user_id uuid NOT NULL REFERENCES public.profiles (id) ON DELETE CASCADE,
  subscription_id text NOT NULL,
  subscription_status text NOT NULL,
  subscription_tier text NOT NULL CHECK (subscription_tier IN ('free', 'pro')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_webhook_events_user_received
  ON public.subscription_webhook_events (user_id, received_at DESC);

ALTER TABLE public.subscription_webhook_events ENABLE ROW LEVEL SECURITY;
