-- 104_store_credentials_resolve_via_account.sql
--
-- Make the ACCOUNT tier the one that actually bills.
--
-- 103 created `provider_accounts`, pointed `tenant_providers.provider_account_id` at it, and
-- backfilled real data — and then nothing read it. Every credential consumer still went to the
-- app-local `tenant_providers.store_credential_enc`, so attaching an app to a different Play
-- console changed a pointer and nothing else: product sync, coupon sync and the "Connected" badge
-- all carried on using the old key. The feature existed in the schema and nowhere in the behaviour.
--
-- The fix is one chokepoint, not N call sites. Every consumer — `stripe-route-helper` (both
-- stores), `googleplay-coupon-sync`, `appstore-coupon-sync` — already calls
-- `tenant_providers_decrypt_store_key(tenant, provider)`. Teaching THAT function to resolve through
-- the account makes the switch real everywhere at once, with no caller edits and nothing to keep in
-- sync later. `tenant_providers_store_status` gets the same treatment so the UI reports the
-- credential the app will actually use rather than a leftover local blob.
--
-- Precedence, and why this order:
--   1. the account this app is pinned to        (explicit per-app choice)
--   2. the account default for this provider    (the reason defaults exist — rotations propagate)
--   3. the app-local blob on tenant_providers   (pre-103 apps; nothing has migrated them yet)
-- App-local LAST is the point: once an operator attaches an app to an account, the account wins.
-- Were the local blob to win, an attached app would keep billing through the old console and the
-- picker would be a lie. Keeping it as the final fallback is what lets an un-migrated app keep
-- working untouched.
--
-- Config is MERGED, account first: the account carries the identity of the credential
-- (`client_email`, `key_id`, `issuer_id`) and the app carries what identifies the app
-- (`package_name`, `bundle_id`). A collision resolves to the app, because the narrower scope is the
-- more specific truth.

-- ── 1. Resolve the credential ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_providers_decrypt_store_key(
  p_tenant_id UUID,
  p_provider  TEXT
)
RETURNS TABLE (credential TEXT, config JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tp        RECORD;
  v_acct      RECORD;
  v_owner     UUID;
  v_cred_enc  BYTEA;
  v_acct_cfg  JSONB := '{}'::jsonb;
BEGIN
  -- Authorisation is unchanged: caller must be an admin of THIS tenant. Resolving through an
  -- account must not widen who may decrypt — an admin of one app cannot read a credential just
  -- because the account that owns it also serves an app they cannot see.
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO v_tp FROM tenant_providers
  WHERE tenant_id = p_tenant_id AND provider = p_provider;

  -- Same owner resolution as tenant_provider_resolve (103): the OWNER is the user whose email is
  -- on the tenant, with the oldest-admin fallback only for a tenant whose owner has not signed up.
  SELECT u.id INTO v_owner
  FROM tenants t JOIN auth.users u ON lower(u.email) = lower(t.owner_email)
  WHERE t.id = p_tenant_id LIMIT 1;
  IF v_owner IS NULL THEN
    SELECT user_id INTO v_owner FROM tenant_admins
    WHERE tenant_id = p_tenant_id ORDER BY created_at LIMIT 1;
  END IF;

  IF v_tp.provider_account_id IS NOT NULL THEN
    SELECT * INTO v_acct FROM provider_accounts WHERE id = v_tp.provider_account_id;
  ELSE
    SELECT a.* INTO v_acct
    FROM provider_accounts a
    WHERE a.provider = p_provider AND a.is_default
      AND a.owner_user_id IN (SELECT user_id FROM tenant_admins WHERE tenant_id = p_tenant_id)
    ORDER BY (a.owner_user_id = v_owner) DESC, a.created_at
    LIMIT 1;
  END IF;

  IF v_acct.id IS NOT NULL AND v_acct.credential_enc IS NOT NULL THEN
    v_cred_enc := v_acct.credential_enc;
    v_acct_cfg := COALESCE(v_acct.config, '{}'::jsonb);
  ELSE
    -- An account with NO credential must not shadow a working local blob: a half-created
    -- connection would otherwise take an app that bills today and stop it billing.
    v_cred_enc := v_tp.store_credential_enc;
  END IF;

  RETURN QUERY
  SELECT
    CASE WHEN v_cred_enc IS NULL THEN NULL
         ELSE decrypt_provider_key(v_cred_enc)::TEXT END,
    v_acct_cfg || COALESCE(v_tp.store_config, '{}'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.tenant_providers_decrypt_store_key(UUID, TEXT) IS
  'Decrypts the store credential this app actually bills through: pinned account → account default → app-local blob. Config merges account (credential identity) under app (app identity).';

REVOKE ALL ON FUNCTION public.tenant_providers_decrypt_store_key(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.tenant_providers_decrypt_store_key(UUID, TEXT) TO authenticated;

-- ── 2. Status reports the RESOLVED credential ────────────────────────────────────────────────
-- The badge has to agree with the behaviour. An app attached to an account with a key was showing
-- "Not connected" whenever its own local blob was empty — which is every app created after 103.
CREATE OR REPLACE FUNCTION public.tenant_providers_store_status(
  p_tenant_id UUID,
  p_provider  TEXT
)
RETURNS TABLE (connected BOOLEAN, config JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_tp       RECORD;
  v_acct     RECORD;
  v_owner    UUID;
  v_conn     BOOLEAN;
  v_acct_cfg JSONB := '{}'::jsonb;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO v_tp FROM tenant_providers
  WHERE tenant_id = p_tenant_id AND provider = p_provider;

  SELECT u.id INTO v_owner
  FROM tenants t JOIN auth.users u ON lower(u.email) = lower(t.owner_email)
  WHERE t.id = p_tenant_id LIMIT 1;
  IF v_owner IS NULL THEN
    SELECT user_id INTO v_owner FROM tenant_admins
    WHERE tenant_id = p_tenant_id ORDER BY created_at LIMIT 1;
  END IF;

  IF v_tp.provider_account_id IS NOT NULL THEN
    SELECT * INTO v_acct FROM provider_accounts WHERE id = v_tp.provider_account_id;
  ELSE
    SELECT a.* INTO v_acct
    FROM provider_accounts a
    WHERE a.provider = p_provider AND a.is_default
      AND a.owner_user_id IN (SELECT user_id FROM tenant_admins WHERE tenant_id = p_tenant_id)
    ORDER BY (a.owner_user_id = v_owner) DESC, a.created_at
    LIMIT 1;
  END IF;

  IF v_acct.id IS NOT NULL AND v_acct.credential_enc IS NOT NULL THEN
    v_conn := true;
    v_acct_cfg := COALESCE(v_acct.config, '{}'::jsonb);
  ELSE
    v_conn := v_tp.store_credential_enc IS NOT NULL;
  END IF;

  RETURN QUERY SELECT v_conn, v_acct_cfg || COALESCE(v_tp.store_config, '{}'::jsonb);
END;
$$;

COMMENT ON FUNCTION public.tenant_providers_store_status(UUID, TEXT) IS
  'Non-secret connectivity probe for the RESOLVED credential (pinned account → account default → app-local). Never returns the blob.';

REVOKE ALL ON FUNCTION public.tenant_providers_store_status(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.tenant_providers_store_status(UUID, TEXT) TO authenticated;

-- ── 3. Saving a store key creates/updates the ACCOUNT, and attaches this app ─────────────────
-- Without this, the only way to get a credential onto the account tier was the backfill: every
-- subsequent save wrote an app-local blob that (by the precedence above) the account now shadows —
-- so a freshly-saved key would appear not to take effect. The save path has to land where the read
-- path looks.
--
-- p_account_id NULL means "the account this app already resolves to, or a new one": re-saving a key
-- for an app that follows the default updates THAT connection rather than silently forking a second
-- one with the same credential.
CREATE OR REPLACE FUNCTION public.tenant_store_account_save(
  p_tenant_id  UUID,
  p_provider   TEXT,
  p_credential TEXT,          -- '' keeps the existing blob
  p_label      TEXT,
  p_acct_cfg   JSONB,         -- account-scoped, non-secret (client_email / key_id / issuer_id)
  p_app_cfg    JSONB,         -- app-scoped, non-secret (package_name / bundle_id)
  p_account_id UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_owner   UUID;
  v_id      UUID;
  v_tp      RECORD;
  v_is_first BOOLEAN;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- The credential is owned by the CALLER, not by the tenant's owner: whoever pastes a key owns it,
  -- and it then serves every app they attach it to.
  v_owner := auth.uid();

  SELECT * INTO v_tp FROM tenant_providers
  WHERE tenant_id = p_tenant_id AND provider = p_provider;

  v_id := COALESCE(p_account_id, v_tp.provider_account_id);

  IF v_id IS NULL THEN
    SELECT a.id INTO v_id
    FROM provider_accounts a
    WHERE a.provider = p_provider AND a.is_default AND a.owner_user_id = v_owner
    LIMIT 1;
  END IF;

  SELECT NOT EXISTS (
    SELECT 1 FROM provider_accounts WHERE owner_user_id = v_owner AND provider = p_provider
  ) INTO v_is_first;

  IF v_id IS NULL THEN
    INSERT INTO provider_accounts (owner_user_id, provider, label, credential_enc, config, is_default)
    VALUES (
      v_owner, p_provider,
      COALESCE(NULLIF(btrim(p_label), ''), p_provider || ' connection'),
      CASE WHEN COALESCE(p_credential,'') = '' THEN NULL
           ELSE encrypt_provider_key(p_credential) END,
      COALESCE(p_acct_cfg, '{}'::jsonb),
      -- The first connection for a provider becomes the default. Nothing else could be: a lone
      -- connection that is not the default leaves every following app resolving to nothing.
      v_is_first
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE provider_accounts SET
      label          = COALESCE(NULLIF(btrim(p_label), ''), label),
      credential_enc = CASE WHEN COALESCE(p_credential,'') = '' THEN credential_enc
                            ELSE encrypt_provider_key(p_credential) END,
      config         = config || COALESCE(p_acct_cfg, '{}'::jsonb),
      updated_at     = now()
    WHERE id = v_id;
  END IF;

  -- Attach this app and record its app-scoped config. The row may not exist yet for a provider the
  -- app has never configured.
  INSERT INTO tenant_providers (tenant_id, provider, provider_account_id, store_config, is_active)
  VALUES (p_tenant_id, p_provider, v_id, COALESCE(p_app_cfg, '{}'::jsonb), true)
  ON CONFLICT (tenant_id, provider) DO UPDATE SET
    provider_account_id = EXCLUDED.provider_account_id,
    store_config        = COALESCE(tenant_providers.store_config, '{}'::jsonb)
                            || COALESCE(p_app_cfg, '{}'::jsonb);

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.tenant_store_account_save(UUID, TEXT, TEXT, TEXT, JSONB, JSONB, UUID) IS
  'Upserts the provider ACCOUNT holding a store credential and attaches this app to it. The save-side twin of tenant_providers_decrypt_store_key.';

REVOKE ALL ON FUNCTION public.tenant_store_account_save(UUID, TEXT, TEXT, TEXT, JSONB, JSONB, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.tenant_store_account_save(UUID, TEXT, TEXT, TEXT, JSONB, JSONB, UUID) TO authenticated;
