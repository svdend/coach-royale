-- Add privacy controls and retention preferences to profiles
ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS data_retention_days integer NOT NULL DEFAULT 365
  CHECK (data_retention_days IN (30, 90, 365)),
ADD COLUMN IF NOT EXISTS privacy_policy_version text,
ADD COLUMN IF NOT EXISTS privacy_policy_accepted_at timestamptz,
ADD COLUMN IF NOT EXISTS byok_local_storage_notice_accepted_at timestamptz;

-- Index for retention-oriented maintenance tasks
CREATE INDEX IF NOT EXISTS idx_profiles_retention_days
  ON public.profiles(data_retention_days);
