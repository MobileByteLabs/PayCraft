-- 194 — the in-app browser sign-in (Custom Tabs / web-auth session / desktop browser) carries the device id.
--
-- 193 binds a verified sign-in to the device that made it, so register_device can mark that device
-- identity-verified. The SDKs' native and web sign-ins send the device id to identity-token/verify; the
-- in-app browser flow verifies the token server-side at /callback instead, so /start now stores the
-- device id on the session and /callback records the claim with it. NULL for older SDKs (no claim).
-- Idempotent.

ALTER TABLE public.identity_sessions
  ADD COLUMN IF NOT EXISTS device_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'identity_sessions_device_id_shape') THEN
    ALTER TABLE public.identity_sessions
      ADD CONSTRAINT identity_sessions_device_id_shape
      CHECK (device_id IS NULL OR device_id ~ '^[A-Za-z0-9._:-]{8,128}$');
  END IF;
END $$;
