-- 170 — identity_sessions.platform (PLAN-paycraft-verified-identity D2b).
--
-- /start records which platform opened the in-app browser so /callback can hand control straight
-- back: Android → intent:// to the app's package, iOS → `<bundle id>.paycraft://` (intercepted by
-- ASWebAuthenticationSession). NULL (older SDKs, desktop/web) keeps the plain "return to the app" page.
--
-- Idempotent: safe to re-run.

ALTER TABLE public.identity_sessions ADD COLUMN IF NOT EXISTS platform text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identity_sessions_platform_check') THEN
    ALTER TABLE public.identity_sessions
      ADD CONSTRAINT identity_sessions_platform_check
      CHECK (platform IS NULL OR platform IN ('android', 'ios', 'web', 'desktop'));
  END IF;
END
$$;
