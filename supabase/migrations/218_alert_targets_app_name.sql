-- 218 — alert emails name the app (owner request 2026-11-26).
--
-- An owner with several apps got "PayCraft: 1 checkout abandoned …" with nothing saying WHICH app. The alert sender
-- (_shared/alert-channels.ts) reads its destinations from tenant_alert_channels_decrypt (211); it now also returns
-- tenants.name as app_name, which goes into the email subject, heading and footer and the Slack text.
--
-- The result columns change, so the function is dropped and recreated (CREATE OR REPLACE cannot change a RETURNS
-- TABLE). Same body, same service-role-only grant. Idempotent.

DROP FUNCTION IF EXISTS public.tenant_alert_channels_decrypt(UUID);

CREATE FUNCTION public.tenant_alert_channels_decrypt(p_tenant_id UUID)
RETURNS TABLE (owner_email TEXT, email_enabled BOOLEAN, inbox_enabled BOOLEAN,
               slack_url TEXT, webhook_url TEXT, webhook_secret TEXT, app_name TEXT)
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
  SELECT t.owner_email::TEXT,
         COALESCE(c.email_enabled, TRUE),
         COALESCE(c.inbox_enabled, TRUE),
         CASE WHEN c.slack_url_enc      IS NULL THEN NULL ELSE decrypt_provider_key(c.slack_url_enc)::TEXT END,
         CASE WHEN c.webhook_url_enc    IS NULL THEN NULL ELSE decrypt_provider_key(c.webhook_url_enc)::TEXT END,
         CASE WHEN c.webhook_secret_enc IS NULL THEN NULL ELSE decrypt_provider_key(c.webhook_secret_enc)::TEXT END,
         NULLIF(btrim(t.name), '')::TEXT
    FROM tenants t LEFT JOIN tenant_alert_channels c ON c.tenant_id = t.id
   WHERE t.id = p_tenant_id;
END;
$$;
REVOKE ALL ON FUNCTION public.tenant_alert_channels_decrypt(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_alert_channels_decrypt(UUID) TO service_role;
