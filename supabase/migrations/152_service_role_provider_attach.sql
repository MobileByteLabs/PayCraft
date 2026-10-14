-- 152 — service-role-safe provider attach + listing, so the MANAGEMENT API can onboard an app
-- without a browser session and without any credential crossing the API boundary.
--
-- ## The problem
--
-- `tenant_provider_attach` and `provider_accounts_list` (103) are written for a logged-in dashboard
-- user: both gate on `auth.uid()`. The v1 management API authenticates a `pcsk_` key and runs as
-- service_role, where `auth.uid()` is NULL — so attach raises `forbidden` and the listing returns
-- `[]`. There was therefore no API path to point a new app at an existing provider credential, and
-- onboarding had to be finished by hand in the dashboard or by a direct psql session.
--
-- ## Why new functions instead of relaxing the old ones
--
-- Migration 084 fixed a related case by prefixing a guard with `auth.uid() IS NOT NULL AND`, which
-- lets service_role through. That is right for a guard that only ever answers "is this user an
-- admin of this tenant" — the API has already proven that much before it calls. It is NOT right
-- here: `tenant_provider_attach`'s second check is an OWNERSHIP test
-- (`owner_user_id = auth.uid()`), and short-circuiting it for service_role would delete the only
-- thing stopping one app from pointing at another account's credential and billing through their
-- Stripe. So the check is RESTATED against the tenant rather than skipped.
--
-- ## The ownership rule, expressed without a session
--
-- An app may attach to a provider account whose OWNER is an owner/admin of that same app. This is
-- the session-free equivalent of 103's `owner_user_id = auth.uid()`: identical in the dashboard
-- case (the caller is that admin), and it still refuses a credential belonging to an unrelated
-- account. It deliberately does NOT widen to "any account" — the id is a request, never a grant.
--
-- NO CREDENTIAL CROSSES THIS BOUNDARY. Attach takes an account id; `credential_enc` stays in
-- `provider_accounts` and is only ever read by the sync, server-side. The listing masks it to
-- `has_credential`.

-- ── Which provider accounts may THIS app attach to? ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.provider_accounts_list_for_tenant(
    p_tenant   UUID,
    p_provider TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', a.id, 'provider', a.provider, 'label', a.label,
           'config', a.config, 'is_default', a.is_default,
           -- Masked, exactly as 103 does: whether a credential exists, never the credential.
           'has_credential', a.credential_enc IS NOT NULL,
           'apps_using', (SELECT count(*) FROM tenant_providers tp WHERE tp.provider_account_id = a.id),
           'attached_to_this_app', EXISTS (
             SELECT 1 FROM tenant_providers tp
             WHERE tp.tenant_id = p_tenant AND tp.provider_account_id = a.id
           ),
           'created_at', a.created_at
         ) ORDER BY a.provider, a.is_default DESC, a.label), '[]'::jsonb)
  FROM provider_accounts a
  WHERE (p_provider IS NULL OR a.provider = p_provider)
    AND EXISTS (
      SELECT 1 FROM tenant_admins ta
      WHERE ta.tenant_id = p_tenant
        AND ta.user_id = a.owner_user_id
        AND ta.role IN ('owner', 'admin')
    );
$$;

COMMENT ON FUNCTION public.provider_accounts_list_for_tenant(UUID, TEXT) IS
  'Provider connections an APP may attach to (owner is an owner/admin of that app), credentials masked. Service-role-safe twin of provider_accounts_list.';

-- ── Attach an app to one of them ───────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_provider_attach_admin(
    p_tenant     UUID,
    p_provider   TEXT,
    p_account_id UUID,
    p_app_config JSONB DEFAULT NULL      -- per-APP ids: {package_name} / {bundle_id}
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_tenant IS NULL OR p_provider IS NULL THEN
    RAISE EXCEPTION 'tenant and provider are required' USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- The ownership rule, restated for a session-free caller. Detaching (NULL account) is allowed:
  -- it points the app at nothing, which cannot reach anyone else's credential.
  IF p_account_id IS NOT NULL AND NOT EXISTS (
      SELECT 1
      FROM provider_accounts a
      JOIN tenant_admins ta
        ON ta.user_id = a.owner_user_id
       AND ta.tenant_id = p_tenant
       AND ta.role IN ('owner', 'admin')
      WHERE a.id = p_account_id
        AND a.provider = p_provider
  ) THEN
    -- Same opacity as the v1 403s: "no such connection" rather than "exists but not yours", so the
    -- error cannot be used to enumerate another account's provider connections.
    RAISE EXCEPTION 'no such connection for this app' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO tenant_providers (tenant_id, provider, provider_account_id, store_config, is_active)
  VALUES (p_tenant, p_provider, p_account_id, COALESCE(p_app_config, '{}'::jsonb), true)
  ON CONFLICT (tenant_id, provider) DO UPDATE
    SET provider_account_id = EXCLUDED.provider_account_id,
        -- An omitted app config keeps the existing one, mirroring 103: re-attaching must not wipe
        -- a package_name/bundle_id the sync depends on.
        store_config        = COALESCE(p_app_config, tenant_providers.store_config),
        is_active           = true,
        updated_at          = now();

  RETURN true;
END;
$$;

COMMENT ON FUNCTION public.tenant_provider_attach_admin(UUID, TEXT, UUID, JSONB) IS
  'Point an app at an account-owned provider credential, without a browser session. Service-role-safe twin of tenant_provider_attach; no credential crosses the call.';

-- Service-role only. These bypass `auth.uid()` by design, so `authenticated` must NOT hold them —
-- a logged-in user calling them would skip the session checks 103 exists to apply.
REVOKE ALL ON FUNCTION public.provider_accounts_list_for_tenant(UUID, TEXT) FROM anon, authenticated, PUBLIC;
REVOKE ALL ON FUNCTION public.tenant_provider_attach_admin(UUID, TEXT, UUID, JSONB) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.provider_accounts_list_for_tenant(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.tenant_provider_attach_admin(UUID, TEXT, UUID, JSONB) TO service_role;
