-- 105_provider_accounts_close_anon.sql
--
-- Close the anon surface that 103 and 104 opened on the provider-account tier.
--
-- Both migrations ended with `REVOKE ALL ON FUNCTION … FROM anon; GRANT … TO authenticated;` and
-- both were wrong in the same way: PostgreSQL grants EXECUTE to **PUBLIC** by default on every new
-- function, `anon` inherits it through PUBLIC, and revoking from `anon` does not touch the PUBLIC
-- grant. The REVOKE therefore read as a lock and locked nothing — measured on production, all eight
-- functions answered `has_function_privilege('anon', …, 'execute') = true`.
--
-- This is the same class migrations 094–097 closed across the rest of the schema. It came back
-- because the REVOKE/GRANT pair was copied from a migration that predates the fix, which is exactly
-- how a closed class reopens: the wrong idiom is the one that gets pasted forward.
--
-- Severity differs per function, and only one was actually exploitable:
--
--   • Seven of them open with `IF NOT EXISTS (SELECT 1 FROM tenant_admins WHERE … user_id =
--     auth.uid()) THEN RAISE EXCEPTION 'forbidden'`. For an anonymous caller `auth.uid()` is NULL,
--     so the body refuses them. The grant was still wrong — defence should not rest on every future
--     edit remembering to keep that first block — but nothing leaked.
--
--   • `tenant_provider_resolve` has NO authorisation check at all, and is SECURITY DEFINER. With
--     PUBLIC EXECUTE, anyone holding the anon key (it ships in every client app by design) and a
--     tenant UUID could read that tenant's provider connection. Verified against production before
--     writing this: an anonymous POST returned `connected: true`, the connection label, the
--     service-account email and the package name. None of that is a credential — no key, no token,
--     nothing decryptable — but a service-account address and an operator's email are exactly the
--     identifiers a targeted phish is built from, and the app_config disclosure maps a tenant UUID
--     to a shipping Android package.
--
-- Two fixes, because either alone is insufficient: revoke the real grant (PUBLIC), AND give
-- `tenant_provider_resolve` the authorisation check every sibling already had.

-- ── 1. Revoke the grant that was actually there ──────────────────────────────────────────────
REVOKE ALL ON FUNCTION public.provider_accounts_list(TEXT)                                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.provider_accounts_save(UUID, TEXT, TEXT, TEXT, JSONB)         FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.provider_accounts_set_default(UUID)                           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tenant_provider_attach(UUID, TEXT, UUID, JSONB)               FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tenant_provider_resolve(UUID, TEXT)                           FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tenant_providers_decrypt_store_key(UUID, TEXT)                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tenant_providers_store_status(UUID, TEXT)                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.tenant_store_account_save(UUID, TEXT, TEXT, TEXT, JSONB, JSONB, UUID) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.provider_accounts_list(TEXT)                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.provider_accounts_save(UUID, TEXT, TEXT, TEXT, JSONB)         TO authenticated;
GRANT EXECUTE ON FUNCTION public.provider_accounts_set_default(UUID)                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_provider_attach(UUID, TEXT, UUID, JSONB)               TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_provider_resolve(UUID, TEXT)                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_providers_decrypt_store_key(UUID, TEXT)                TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_providers_store_status(UUID, TEXT)                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_store_account_save(UUID, TEXT, TEXT, TEXT, JSONB, JSONB, UUID) TO authenticated;

-- ── 2. Give tenant_provider_resolve the guard its siblings already had ───────────────────────
-- Defence in depth, not belt-and-braces: the grant above is the lock, and this is what keeps the
-- function safe if a later migration re-creates it and pastes the wrong REVOKE idiom again.
CREATE OR REPLACE FUNCTION public.tenant_provider_resolve(p_tenant UUID, p_provider TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_owner UUID; v_tp RECORD; v_acct RECORD;
BEGIN
  -- Caller must be an admin of THIS tenant. Same shape as every other function on this tier.
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO v_tp FROM tenant_providers
  WHERE tenant_id = p_tenant AND provider = p_provider;

  -- The account is the OWNER: the user whose email is on the tenant. The admin fallback stays for a
  -- tenant whose owner_email has no auth user yet (invited, not signed up).
  SELECT u.id INTO v_owner
  FROM tenants t JOIN auth.users u ON lower(u.email) = lower(t.owner_email)
  WHERE t.id = p_tenant LIMIT 1;
  IF v_owner IS NULL THEN
    SELECT user_id INTO v_owner FROM tenant_admins
    WHERE tenant_id = p_tenant ORDER BY created_at LIMIT 1;
  END IF;

  IF v_tp.provider_account_id IS NOT NULL THEN
    SELECT * INTO v_acct FROM provider_accounts WHERE id = v_tp.provider_account_id;
  ELSE
    -- Any ADMIN's default can carry the app, preferring the owner's. A team where the credential was
    -- added by a colleague must still bill; requiring it to be the owner's would strand the app.
    SELECT a.* INTO v_acct
    FROM provider_accounts a
    WHERE a.provider = p_provider AND a.is_default
      AND a.owner_user_id IN (SELECT user_id FROM tenant_admins WHERE tenant_id = p_tenant)
    ORDER BY (a.owner_user_id = v_owner) DESC, a.created_at
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'provider',    p_provider,
    'connected',   v_acct.id IS NOT NULL AND v_acct.credential_enc IS NOT NULL,
    'account_id',  v_acct.id,
    'label',       v_acct.label,
    'via_default', v_tp.provider_account_id IS NULL AND v_acct.id IS NOT NULL,
    'config',      COALESCE(v_acct.config,'{}'::jsonb),
    'app_config',  COALESCE(v_tp.store_config,'{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.tenant_provider_resolve(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_provider_resolve(UUID, TEXT) TO authenticated;

COMMENT ON FUNCTION public.tenant_provider_resolve(UUID, TEXT) IS
  'What this app bills through right now (pinned account → account default). Admin-only; anon has no EXECUTE.';
