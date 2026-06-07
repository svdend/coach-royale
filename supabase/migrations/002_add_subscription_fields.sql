-- Add subscription fields to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS subscription_tier text DEFAULT 'free' CHECK (subscription_tier IN ('free', 'pro')),
ADD COLUMN IF NOT EXISTS subscription_id text,
ADD COLUMN IF NOT EXISTS subscription_status text,
ADD COLUMN IF NOT EXISTS subscription_renews_at timestamptz,
ADD COLUMN IF NOT EXISTS subscription_ends_at timestamptz;

-- Index for quick tier lookups
CREATE INDEX IF NOT EXISTS idx_profiles_tier ON public.profiles(subscription_tier);
