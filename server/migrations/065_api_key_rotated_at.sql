-- 065_api_key_rotated_at.sql
--
-- Phase 4 of paycraft-v2-production-readiness — backs the
-- /api/api-keys/rotate UX badge ("Last rotated N days ago") with real
-- timestamps so the settings page stops showing hard-coded "12 days ago".
--
-- Idempotent: each ALTER uses IF NOT EXISTS so re-running on an
-- already-migrated DB is a no-op (per CLAUDE.md migration rules).

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS api_key_test_rotated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS api_key_live_rotated_at TIMESTAMPTZ;

-- Backfill: for tenants that already exist, default the rotation timestamp
-- to created_at so the UI shows the correct age right away (and the
-- "rotate every 90 days" warning fires on real >90d-old keys, not all keys).
UPDATE public.tenants
  SET api_key_test_rotated_at = COALESCE(api_key_test_rotated_at, created_at),
      api_key_live_rotated_at = COALESCE(api_key_live_rotated_at, created_at)
  WHERE api_key_test_rotated_at IS NULL OR api_key_live_rotated_at IS NULL;

COMMENT ON COLUMN public.tenants.api_key_test_rotated_at
  IS 'Last time the pk_test_* key was rotated. Driven by /api/api-keys/rotate?mode=test. Used by /settings/api-keys UI to surface key age + rotation reminder.';
COMMENT ON COLUMN public.tenants.api_key_live_rotated_at
  IS 'Last time the pk_live_* key was rotated. Driven by /api/api-keys/rotate?mode=live. Used by /settings/api-keys UI to surface key age + rotation reminder.';
