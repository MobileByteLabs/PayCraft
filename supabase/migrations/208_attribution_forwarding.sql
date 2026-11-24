-- 208 — Attribution forwarding: verified purchase lifecycle events → the app's GA4 / AppsFlyer.
--
-- The SDK only ever sees the purchase it started; a renewal or refund happens at the store/PSP and
-- reaches PayCraft by webhook. Forwarding those server-side lets ad campaigns optimise for buyers
-- and counts renewals. Three pieces:
--
--   tenant_attribution_integrations — per app, per platform ('ga4' | 'appsflyer'): the non-secret ids
--     (ga4 {firebase_app_id}, appsflyer {app_id}) + the secret (GA4 api_secret / AppsFlyer dev key)
--     encrypted with the SAME pgcrypto helpers as tenant_providers (encrypt_provider_key over
--     app.encryption_key). Plaintext never stored; the dashboard can write and clear, never read back.
--   device_attribution_ids — what the SDK posts (attribution-ids function): Firebase app_instance_id and
--     AppsFlyer id per registered device. An entitlement's owner (app_user_id = email ?: device id) is
--     resolved to its devices by attribution_ids_for_user().
--   attribution_forwards — the send log. UNIQUE (integration, provider, stable_txn_id, event_kind,
--     period_key) makes each lifecycle event forward at most once, whatever replays the webhooks do.
--
-- Idempotent.

-- ── 1. Tenant integration config ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_attribution_integrations (
  tenant_id  UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  platform   TEXT        NOT NULL CHECK (platform IN ('ga4', 'appsflyer')),
  config     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  secret_enc BYTEA       NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, platform)
);
ALTER TABLE public.tenant_attribution_integrations ENABLE ROW LEVEL SECURITY;
-- No policies: service_role only. Admins go through the RPCs below.

COMMENT ON TABLE public.tenant_attribution_integrations IS
  'Per-app ad/analytics forwarding credentials. ga4: config {firebase_app_id}, secret = Measurement Protocol api_secret. appsflyer: config {app_id}, secret = dev key. Secret pgcrypto-encrypted, never returned to the dashboard.';

-- Save: '' / NULL secret keeps the stored one (edit the id without re-pasting); first save needs it.
CREATE OR REPLACE FUNCTION public.tenant_attribution_save(
  p_tenant_id UUID,
  p_platform  TEXT,
  p_config    JSONB,
  p_secret    TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_platform NOT IN ('ga4', 'appsflyer') THEN
    RAISE EXCEPTION 'unknown_platform' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(p_secret, '') = '' THEN
    UPDATE tenant_attribution_integrations
       SET config = COALESCE(p_config, '{}'::jsonb), updated_at = now()
     WHERE tenant_id = p_tenant_id AND platform = p_platform;
    IF NOT FOUND THEN RAISE EXCEPTION 'secret_required' USING ERRCODE = '22023'; END IF;
    RETURN;
  END IF;

  INSERT INTO tenant_attribution_integrations (tenant_id, platform, config, secret_enc, updated_at)
  VALUES (p_tenant_id, p_platform, COALESCE(p_config, '{}'::jsonb), encrypt_provider_key(p_secret), now())
  ON CONFLICT (tenant_id, platform) DO UPDATE SET
    config = EXCLUDED.config, secret_enc = EXCLUDED.secret_enc, updated_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.tenant_attribution_delete(p_tenant_id UUID, p_platform TEXT) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM tenant_attribution_integrations WHERE tenant_id = p_tenant_id AND platform = p_platform;
END;
$$;

-- Status: non-secret config only — what the dashboard renders.
CREATE OR REPLACE FUNCTION public.tenant_attribution_status(p_tenant_id UUID)
RETURNS TABLE (platform TEXT, config JSONB, updated_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT i.platform, i.config, i.updated_at FROM tenant_attribution_integrations i WHERE i.tenant_id = p_tenant_id;
END;
$$;

-- Decrypt: the forwarder (edge functions, service_role) only. Not granted to authenticated.
CREATE OR REPLACE FUNCTION public.tenant_attribution_decrypt(p_tenant_id UUID)
RETURNS TABLE (platform TEXT, config JSONB, secret TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT i.platform, i.config, decrypt_provider_key(i.secret_enc)::TEXT
  FROM tenant_attribution_integrations i WHERE i.tenant_id = p_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.tenant_attribution_save(UUID, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tenant_attribution_delete(UUID, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tenant_attribution_status(UUID) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tenant_attribution_decrypt(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_attribution_save(UUID, TEXT, JSONB, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_attribution_delete(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_attribution_status(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tenant_attribution_decrypt(UUID) TO service_role;

-- ── 2. Per-device attribution ids ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.device_attribution_ids (
  device_row_id            UUID        PRIMARY KEY REFERENCES public.registered_devices(id) ON DELETE CASCADE,
  tenant_id                UUID        REFERENCES public.tenants(id) ON DELETE CASCADE,
  firebase_app_instance_id TEXT        CHECK (firebase_app_instance_id IS NULL OR length(firebase_app_instance_id) <= 64),
  appsflyer_id             TEXT        CHECK (appsflyer_id IS NULL OR length(appsflyer_id) <= 64),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_device_attribution_ids_tenant ON public.device_attribution_ids (tenant_id, updated_at DESC);
ALTER TABLE public.device_attribution_ids ENABLE ROW LEVEL SECURITY;
-- No policies: written by the attribution-ids function, read by the forwarder (both service_role).

-- The newest id of each kind across the owner's devices. app_user_id is the SDK's `email ?: deviceId`.
CREATE OR REPLACE FUNCTION public.attribution_ids_for_user(p_tenant_id UUID, p_app_user_id TEXT)
RETURNS TABLE (firebase_app_instance_id TEXT, appsflyer_id TEXT)
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  WITH owned AS (
    SELECT a.* FROM device_attribution_ids a
    JOIN registered_devices d ON d.id = a.device_row_id
    WHERE a.tenant_id = p_tenant_id
      AND (lower(d.email) = lower(p_app_user_id) OR d.device_id = p_app_user_id)
  )
  SELECT
    (SELECT o.firebase_app_instance_id FROM owned o WHERE o.firebase_app_instance_id IS NOT NULL ORDER BY o.updated_at DESC LIMIT 1),
    (SELECT o.appsflyer_id FROM owned o WHERE o.appsflyer_id IS NOT NULL ORDER BY o.updated_at DESC LIMIT 1);
$$;
REVOKE ALL ON FUNCTION public.attribution_ids_for_user(UUID, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attribution_ids_for_user(UUID, TEXT) TO service_role;

-- ── 3. Forward log (at-most-once) ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attribution_forwards (
  id            BIGSERIAL   PRIMARY KEY,
  tenant_id     UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  integration   TEXT        NOT NULL CHECK (integration IN ('ga4', 'appsflyer')),
  provider      TEXT        NOT NULL,
  stable_txn_id TEXT        NOT NULL,
  event_kind    TEXT        NOT NULL CHECK (event_kind IN ('trial_start', 'purchase', 'renewal', 'refund')),
  period_key    TEXT        NOT NULL DEFAULT '',
  -- pending: claimed, being sent · sent · failed: platform refused / network (retried) · no_ids: the
  -- owner had not posted an id for this platform yet (retried on the txn's next event).
  status        TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'no_ids')),
  attempts      INT         NOT NULL DEFAULT 1,
  http_status   INT,
  error         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attribution_forwards_once') THEN
    ALTER TABLE public.attribution_forwards
      ADD CONSTRAINT attribution_forwards_once UNIQUE (integration, provider, stable_txn_id, event_kind, period_key);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_attribution_forwards_txn
  ON public.attribution_forwards (provider, stable_txn_id) WHERE status IN ('failed', 'no_ids');
ALTER TABLE public.attribution_forwards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attribution_forwards_admin_read ON public.attribution_forwards;
CREATE POLICY attribution_forwards_admin_read ON public.attribution_forwards FOR SELECT
  USING (tenant_id IN (SELECT ta.tenant_id FROM public.tenant_admins ta WHERE ta.user_id = auth.uid()));
