-- 113_local_credential_beats_inherited_default.sql
--
-- An app's OWN credential must beat an account default it never asked for.
--
-- 104 set the precedence as: pinned account → account default → app-local. The last two are in the
-- wrong order, and a test caught it the moment PSPs joined the tier.
--
-- What happens with the old order: an operator runs six apps, each with its own Stripe key on its
-- own row (the pre-account world, and still the state of every PSP app because — unlike the stores
-- in 103 — nothing backfilled them). They open app A and create their first account-level Stripe
-- connection. That connection becomes the default, because the first connection for a provider has
-- to be. The default is scoped to the OWNER, and they own all six apps. So apps B through F — never
-- touched, never attached, still holding perfectly good keys — silently start billing through app
-- A's connection. Nothing in the UI changes. The first sign is money arriving in the wrong Stripe
-- account.
--
-- The reason the order looked right is that it reads as "the account is the source of truth". But a
-- DEFAULT is not an assertion about a specific app; it is what an app inherits when it has nothing
-- of its own. An app holding its own working credential is not asking to inherit anything. An
-- explicit PIN is a statement about that app and still wins — which is what makes attaching an app
-- to a connection take effect, the property 104 existed to create.
--
-- Corrected precedence, applied to every reader on the tier:
--   1. the account this app is PINNED to        — a deliberate statement about this app
--   2. this app's OWN credential                — it is not looking to inherit
--   3. the account default                      — inheritance, for an app with nothing
--
-- Stores are changed too even though the hazard is not live for them (all six store apps are
-- currently pinned, and 109's save path always attaches, so a store app can no longer acquire a
-- local blob without a pin). Leaving the two tiers on different precedence rules would mean the
-- answer to "which credential does this app use?" depends on which provider you ask about — and
-- that difference would be invisible until it mattered.

-- ── 1. Stores: credential ────────────────────────────────────────────────────────────────────
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
  v_use_acct  BOOLEAN := true;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO v_tp FROM tenant_providers
  WHERE tenant_id = p_tenant_id AND provider = p_provider;

  IF v_tp.provider_account_id IS NOT NULL THEN
    -- 1. Pinned.
    SELECT * INTO v_acct FROM provider_accounts WHERE id = v_tp.provider_account_id;
  ELSIF v_tp.store_credential_enc IS NOT NULL THEN
    -- 2. Its own credential — do not look at the default at all.
    v_use_acct := false;
    SELECT * INTO v_acct FROM provider_accounts WHERE false;
  ELSE
    -- 3. Inherit.
    SELECT u.id INTO v_owner
    FROM tenants t JOIN auth.users u ON lower(u.email) = lower(t.owner_email)
    WHERE t.id = p_tenant_id LIMIT 1;
    IF v_owner IS NULL THEN
      SELECT user_id INTO v_owner FROM tenant_admins
      WHERE tenant_id = p_tenant_id ORDER BY created_at LIMIT 1;
    END IF;

    SELECT a.* INTO v_acct
    FROM provider_accounts a
    WHERE a.provider = p_provider AND a.is_default
      AND a.owner_user_id IN (SELECT user_id FROM tenant_admins WHERE tenant_id = p_tenant_id)
    ORDER BY (a.owner_user_id = v_owner) DESC, a.created_at
    LIMIT 1;
  END IF;

  IF v_use_acct AND v_acct.id IS NOT NULL AND v_acct.credential_enc IS NOT NULL THEN
    v_cred_enc := v_acct.credential_enc;
    v_acct_cfg := COALESCE(v_acct.config, '{}'::jsonb);
  ELSE
    v_cred_enc := v_tp.store_credential_enc;
  END IF;

  RETURN QUERY
  SELECT
    CASE WHEN v_cred_enc IS NULL THEN NULL
         ELSE decrypt_provider_key(v_cred_enc)::TEXT END,
    v_acct_cfg || COALESCE(v_tp.store_config, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.tenant_providers_decrypt_store_key(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_providers_decrypt_store_key(UUID, TEXT) TO authenticated, service_role;

-- ── 2. Stores: status must report the SAME credential the reader will use ────────────────────
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
  v_use_acct BOOLEAN := true;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO v_tp FROM tenant_providers
  WHERE tenant_id = p_tenant_id AND provider = p_provider;

  IF v_tp.provider_account_id IS NOT NULL THEN
    SELECT * INTO v_acct FROM provider_accounts WHERE id = v_tp.provider_account_id;
  ELSIF v_tp.store_credential_enc IS NOT NULL THEN
    v_use_acct := false;
    SELECT * INTO v_acct FROM provider_accounts WHERE false;
  ELSE
    SELECT u.id INTO v_owner
    FROM tenants t JOIN auth.users u ON lower(u.email) = lower(t.owner_email)
    WHERE t.id = p_tenant_id LIMIT 1;
    IF v_owner IS NULL THEN
      SELECT user_id INTO v_owner FROM tenant_admins
      WHERE tenant_id = p_tenant_id ORDER BY created_at LIMIT 1;
    END IF;

    SELECT a.* INTO v_acct
    FROM provider_accounts a
    WHERE a.provider = p_provider AND a.is_default
      AND a.owner_user_id IN (SELECT user_id FROM tenant_admins WHERE tenant_id = p_tenant_id)
    ORDER BY (a.owner_user_id = v_owner) DESC, a.created_at
    LIMIT 1;
  END IF;

  IF v_use_acct AND v_acct.id IS NOT NULL AND v_acct.credential_enc IS NOT NULL THEN
    v_conn := true;
    v_acct_cfg := COALESCE(v_acct.config, '{}'::jsonb);
  ELSE
    v_conn := v_tp.store_credential_enc IS NOT NULL;
  END IF;

  RETURN QUERY SELECT v_conn, v_acct_cfg || COALESCE(v_tp.store_config, '{}'::jsonb);
END;
$$;

REVOKE ALL ON FUNCTION public.tenant_providers_store_status(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_providers_store_status(UUID, TEXT) TO authenticated, service_role;

-- ── 3. PSPs: the shared resolver ─────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_psp_credential_resolve(
  p_tenant_id UUID,
  p_provider  TEXT,
  p_mode      TEXT
)
RETURNS TABLE (secret_key TEXT, webhook_secret TEXT, key_id TEXT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_tp       RECORD;
  v_acct     RECORD;
  v_owner    UUID;
  v_doc      JSONB;
  v_pfx      TEXT := CASE WHEN p_mode = 'live' THEN 'live' ELSE 'test' END;
  v_has_local BOOLEAN;
  v_use_acct  BOOLEAN := true;
BEGIN
  SELECT * INTO v_tp FROM tenant_providers
  WHERE tenant_id = p_tenant_id AND provider = p_provider;

  v_has_local := CASE WHEN p_mode = 'live' THEN v_tp.live_secret_key_enc IS NOT NULL
                      ELSE v_tp.test_secret_key_enc IS NOT NULL END;

  IF v_tp.provider_account_id IS NOT NULL THEN
    SELECT * INTO v_acct FROM provider_accounts WHERE id = v_tp.provider_account_id;
  ELSIF v_has_local THEN
    -- This app has its own key for this mode. A default it never asked for must not take it.
    v_use_acct := false;
    SELECT * INTO v_acct FROM provider_accounts WHERE false;
  ELSE
    SELECT u.id INTO v_owner
    FROM tenants t JOIN auth.users u ON lower(u.email) = lower(t.owner_email)
    WHERE t.id = p_tenant_id LIMIT 1;
    IF v_owner IS NULL THEN
      SELECT user_id INTO v_owner FROM tenant_admins
      WHERE tenant_id = p_tenant_id ORDER BY created_at LIMIT 1;
    END IF;

    SELECT a.* INTO v_acct
    FROM provider_accounts a
    WHERE a.provider = p_provider AND a.is_default
      AND a.owner_user_id IN (SELECT user_id FROM tenant_admins WHERE tenant_id = p_tenant_id)
    ORDER BY (a.owner_user_id = v_owner) DESC, a.created_at
    LIMIT 1;
  END IF;

  IF v_use_acct AND v_acct.id IS NOT NULL AND v_acct.credential_enc IS NOT NULL THEN
    BEGIN
      v_doc := decrypt_provider_key(v_acct.credential_enc)::JSONB;
    EXCEPTION WHEN OTHERS THEN
      v_doc := NULL;
    END;
  END IF;

  IF v_doc IS NOT NULL AND NULLIF(v_doc->>(v_pfx || '_secret'), '') IS NOT NULL THEN
    RETURN QUERY SELECT
      v_doc->>(v_pfx || '_secret'),
      NULLIF(v_doc->>(v_pfx || '_webhook_secret'), ''),
      NULLIF(v_doc->>(v_pfx || '_key_id'), '');
    RETURN;
  END IF;

  IF p_mode = 'live' THEN
    RETURN QUERY SELECT decrypt_provider_key(v_tp.live_secret_key_enc)::TEXT,
                        decrypt_provider_key(v_tp.live_webhook_secret_enc)::TEXT,
                        v_tp.live_key_id;
  ELSE
    RETURN QUERY SELECT decrypt_provider_key(v_tp.test_secret_key_enc)::TEXT,
                        decrypt_provider_key(v_tp.test_webhook_secret_enc)::TEXT,
                        v_tp.test_key_id;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.tenant_psp_credential_resolve(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_psp_credential_resolve(UUID, TEXT, TEXT) TO service_role;

COMMENT ON FUNCTION public.tenant_psp_credential_resolve(UUID, TEXT, TEXT) IS
  'Internal: PSP credential for this app — pinned account → app-local → account default. A default never displaces a credential the app already holds.';
