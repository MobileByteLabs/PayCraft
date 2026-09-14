-- 109_store_account_create_new.sql
--
-- Let an operator connect the SECOND Play console, and stop the first attempt from destroying the
-- first one.
--
-- 104's `tenant_store_account_save` resolves `COALESCE(p_account_id, v_tp.provider_account_id)` and
-- UPDATEs whatever it lands on. That was right for the only flow that existed — rotate this app's
-- key — and wrong for the flow the feature is actually for. A connection is shared: `provider_accounts`
-- holds ONE credential that many apps attach to. So pasting a second console's service-account JSON
-- on an app that is already attached did not create a second connection; it overwrote the first, and
-- every other app attached to it silently started billing through the new console. The operator's
-- only signal would have been revenue moving to the wrong account.
--
-- Three changes, in order of how much they matter:
--
--   1. **An explicit create.** `p_create_new` INSERTs a new connection instead of resolving to an
--      existing one. This is the "connect N accounts" path and it needs to be a separate intent,
--      not an inference — there is no way to tell "rotate this key" from "add another console"
--      by looking at the payload, and guessing wrong is destructive in one direction and merely
--      annoying in the other.
--
--   2. **A guard on the destructive case.** Replacing the credential on a connection used by MORE
--      THAN ONE app now raises unless `p_confirm_shared` is passed. The API turns that into a 409
--      and the UI asks, naming the count. Rotating a genuinely shared key is legitimate and stays
--      possible; doing it by accident does not.
--
--   3. **An ownership check on `p_account_id`.** 104 accepted any UUID and updated it. The caller
--      must now own the connection, or share a tenant with whoever does — the same relationship
--      `tenant_provider_resolve` already uses to decide which default an app may ride.
--
-- The old 7-argument function is DROPPED rather than left beside this one. Adding parameters to a
-- `CREATE OR REPLACE` would have produced an OVERLOAD, and this migration series has already been
-- bitten twice by overloads hiding behind a shared name (`is_premium(user_email)` in 107,
-- `tenant_stripe_connect_decrypt` in the same sweep). Two callers exist, both updated in this change.

DROP FUNCTION IF EXISTS public.tenant_store_account_save(UUID, TEXT, TEXT, TEXT, JSONB, JSONB, UUID);

CREATE OR REPLACE FUNCTION public.tenant_store_account_save(
  p_tenant_id      UUID,
  p_provider       TEXT,
  p_credential     TEXT,                    -- '' keeps the existing blob
  p_label          TEXT,
  p_acct_cfg       JSONB,                   -- account-scoped, non-secret
  p_app_cfg        JSONB,                   -- app-scoped, non-secret
  p_account_id     UUID    DEFAULT NULL,    -- update THIS connection
  p_create_new     BOOLEAN DEFAULT false,   -- insert a NEW connection instead of resolving
  p_confirm_shared BOOLEAN DEFAULT false    -- permit replacing a credential used by >1 app
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_owner    UUID;
  v_id       UUID;
  v_tp       RECORD;
  v_is_first BOOLEAN;
  v_in_use   INT;
  v_acct     RECORD;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Whoever pastes a key owns it; it then serves every app they attach it to.
  v_owner := auth.uid();

  SELECT * INTO v_tp FROM tenant_providers
  WHERE tenant_id = p_tenant_id AND provider = p_provider;

  IF p_create_new THEN
    -- A connection with no credential is not a connection — it would resolve to "not connected"
    -- and shadow nothing, leaving the operator with a row that does nothing.
    IF COALESCE(p_credential, '') = '' THEN
      RAISE EXCEPTION 'credential_required_for_new_connection';
    END IF;
    v_id := NULL;
  ELSE
    v_id := p_account_id;

    IF v_id IS NOT NULL THEN
      SELECT * INTO v_acct FROM provider_accounts WHERE id = v_id;
      IF v_acct.id IS NULL THEN
        RAISE EXCEPTION 'unknown_connection';
      END IF;
      -- Own it, or share a tenant with whoever does. Same relationship tenant_provider_resolve
      -- uses when deciding which default an app may ride.
      IF v_acct.owner_user_id <> v_owner
         AND NOT EXISTS (
           SELECT 1 FROM tenant_admins ta
           WHERE ta.user_id = v_acct.owner_user_id AND ta.tenant_id = p_tenant_id
         ) THEN
        RAISE EXCEPTION 'forbidden_connection';
      END IF;
    ELSE
      v_id := v_tp.provider_account_id;
      IF v_id IS NULL THEN
        SELECT a.id INTO v_id
        FROM provider_accounts a
        WHERE a.provider = p_provider AND a.is_default AND a.owner_user_id = v_owner
        LIMIT 1;
      END IF;
    END IF;
  END IF;

  -- Replacing a credential that other apps depend on: legitimate as a rotation, destructive as an
  -- accident, and indistinguishable from the payload. So it requires saying so.
  IF v_id IS NOT NULL AND COALESCE(p_credential, '') <> '' AND NOT p_confirm_shared THEN
    SELECT count(*) INTO v_in_use FROM tenant_providers WHERE provider_account_id = v_id;
    IF v_in_use > 1 THEN
      RAISE EXCEPTION 'shared_credential_in_use:%', v_in_use;
    END IF;
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
      -- The FIRST connection for a provider becomes the default; a later one does not silently
      -- steal it. Moving the default is its own deliberate action (provider_accounts_set_default),
      -- because it moves every app that follows it.
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

  -- Attach this app and record its app-scoped config.
  INSERT INTO tenant_providers (tenant_id, provider, provider_account_id, store_config, is_active)
  VALUES (p_tenant_id, p_provider, v_id, COALESCE(p_app_cfg, '{}'::jsonb), true)
  ON CONFLICT (tenant_id, provider) DO UPDATE SET
    provider_account_id = EXCLUDED.provider_account_id,
    store_config        = COALESCE(tenant_providers.store_config, '{}'::jsonb)
                            || COALESCE(p_app_cfg, '{}'::jsonb);

  RETURN v_id;
END;
$$;

COMMENT ON FUNCTION public.tenant_store_account_save(UUID, TEXT, TEXT, TEXT, JSONB, JSONB, UUID, BOOLEAN, BOOLEAN) IS
  'Upserts the provider ACCOUNT holding a store credential and attaches this app. p_create_new inserts a new connection; replacing a credential used by >1 app requires p_confirm_shared.';

REVOKE ALL ON FUNCTION public.tenant_store_account_save(UUID, TEXT, TEXT, TEXT, JSONB, JSONB, UUID, BOOLEAN, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_store_account_save(UUID, TEXT, TEXT, TEXT, JSONB, JSONB, UUID, BOOLEAN, BOOLEAN) TO authenticated, service_role;
