# Supabase Schema

This directory contains the application schema expected by the web app and the Worker BFF.

## Migration order

1. `migrations/001_initial_schema.sql`
2. `migrations/002_add_subscription_fields.sql`
3. `migrations/003_add_privacy_controls.sql`

## What the schema contains

`001_initial_schema.sql` creates:

- `profiles`
- `tracked_players`
- `player_snapshots`
- `battles`
- `favorite_decks`
- `deck_stats`
- `analysis_history`
- RLS policies for user-scoped access
- an `auth.users` signup trigger that creates `profiles` rows

`002_add_subscription_fields.sql` adds:

- `subscription_tier`
- `subscription_id`
- `subscription_status`
- `subscription_renews_at`
- `subscription_ends_at`

`003_add_privacy_controls.sql` adds:

- `data_retention_days`
- `privacy_policy_version`
- `privacy_policy_accepted_at`
- `byok_local_storage_notice_accepted_at`

## Runtime expectations

- The browser uses Supabase directly for OAuth/session handling.
- The Worker uses the anon key for token introspection and the service role key for server-side writes.
- The Worker assumes the subscription fields exist on `profiles`.
- The Worker assumes the privacy-control fields exist on `profiles` so it can export data, erase accounts, and enforce retention windows.

## Operational note

If you apply these migrations outside the Supabase CLI, keep the ordering intact. The Worker and web app both assume the full schema, not a partial state.
