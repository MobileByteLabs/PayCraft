-- 103_account_provider_connections.sql
--
-- Provider credentials move from PER-APP to PER-ACCOUNT, with many connections per provider.
--
-- ## The shape this replaces
-- `tenant_providers` is UNIQUE(tenant_id, provider): exactly one Google Play credential per app. An
-- operator running six apps off ONE Play console pasted the same service-account JSON six times, and
-- rotating it meant six edits — six chances to miss one and leave an app unable to bill. There was
-- also nowhere to put a SECOND Play console (an agency holding a client's account, a separate
-- publisher for a white-label), because the table allowed exactly one row per app per provider.
--
-- Now: a connection belongs to the ACCOUNT (the owner user), an account may hold any number per
-- provider, and each app points at one. One is the default, which is what a new app picks up.
--
-- ## The scope bug this fixes on the way
-- `tenant_providers.store_config` held BOTH scopes at once: `package_name` / `bundle_id` are
-- per-APP (they identify the app in the store), while `key_id` / `issuer_id` are per-ACCOUNT (they
-- identify the API key). Storing them together is WHY the credential could not be shared — half of
-- that JSON was about one app. They are split here: account config travels with the credential, app
-- config stays on the app.
--
-- Idempotent. Existing per-app credentials are BACKFILLED into account connections and re-pointed,
-- so nothing is re-entered and no app loses billing mid-flight.

-- ── 1. Account-level connections ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.provider_accounts (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_user_id   UUID        NOT NULL,
    provider        TEXT        NOT NULL,
    label           TEXT        NOT NULL,
    credential_enc  BYTEA,
    config          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    is_default      BOOLEAN     NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.provider_accounts IS
  'Provider credentials owned by an ACCOUNT (owner user). Many per provider; each app points at one.';
COMMENT ON COLUMN public.provider_accounts.config IS
  'Non-secret ACCOUNT-scoped ids only: app_store={key_id,issuer_id}, google_play={client_email}. Never package_name/bundle_id — those identify an APP.';

CREATE INDEX IF NOT EXISTS idx_provider_accounts_owner ON public.provider_accounts (owner_user_id, provider);

-- At most ONE default per (owner, provider), enforced by the database: "which credential does a new
-- app use" must not depend on insert order.
CREATE UNIQUE INDEX IF NOT EXISTS uq_provider_accounts_default
    ON public.provider_accounts (owner_user_id, provider)
    WHERE is_default;

ALTER TABLE public.provider_accounts ENABLE ROW LEVEL SECURITY;

-- No client-role policy: credentials are reached only through SECURITY DEFINER RPCs that mask them.
DROP POLICY IF EXISTS provider_accounts_service_role ON public.provider_accounts;
CREATE POLICY provider_accounts_service_role ON public.provider_accounts FOR ALL
    USING (current_setting('role') = 'service_role')
    WITH CHECK (current_setting('role') = 'service_role');

-- ── 2. Each app points at one connection ───────────────────────────────────────────────────────
ALTER TABLE public.tenant_providers
    ADD COLUMN IF NOT EXISTS provider_account_id UUID REFERENCES public.provider_accounts(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.tenant_providers.provider_account_id IS
  'Which account connection this app bills through. NULL = the owner''s default for this provider.';

-- ── 3. Backfill — every existing per-app credential becomes an account connection ──────────────
DO $$
DECLARE
  r RECORD; v_owner UUID; v_label TEXT; v_acct UUID; v_cfg JSONB;
BEGIN
  FOR r IN
    SELECT tp.id, tp.tenant_id, tp.provider, tp.store_credential_enc, tp.store_config, t.name AS tenant_name
    FROM public.tenant_providers tp
    JOIN public.tenants t ON t.id = tp.tenant_id
    WHERE tp.store_credential_enc IS NOT NULL AND tp.provider_account_id IS NULL
  LOOP
    -- Same ownership rule as the resolver: the tenant's OWNER, not the earliest admin.
    SELECT u.id INTO v_owner
    FROM public.tenants t JOIN auth.users u ON lower(u.email) = lower(t.owner_email)
    WHERE t.id = r.tenant_id LIMIT 1;
    IF v_owner IS NULL THEN
      SELECT user_id INTO v_owner FROM public.tenant_admins
      WHERE tenant_id = r.tenant_id ORDER BY created_at LIMIT 1;
    END IF;
    IF v_owner IS NULL THEN CONTINUE; END IF;   -- orphaned tenant: no account to attach to

    v_label := COALESCE(NULLIF(r.store_config->>'client_email',''),
                        NULLIF(r.store_config->>'issuer_id',''),
                        r.tenant_name || ' ' || r.provider);
    v_cfg   := COALESCE(r.store_config,'{}'::jsonb) - 'package_name' - 'bundle_id';

    INSERT INTO public.provider_accounts (owner_user_id, provider, label, credential_enc, config, is_default)
    VALUES (v_owner, r.provider, v_label, r.store_credential_enc, v_cfg,
            NOT EXISTS (SELECT 1 FROM public.provider_accounts
                        WHERE owner_user_id = v_owner AND provider = r.provider AND is_default))
    RETURNING id INTO v_acct;

    UPDATE public.tenant_providers SET provider_account_id = v_acct, updated_at = now() WHERE id = r.id;
  END LOOP;
END $$;

-- ── 4. Read — connections for the signed-in account, credentials MASKED ────────────────────────
-- The blob never leaves the database through this path. The dashboard needs to know a connection
-- EXISTS, what it is called and whether it is the default; it never needs the key itself.
CREATE OR REPLACE FUNCTION public.provider_accounts_list(p_provider TEXT DEFAULT NULL)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'id', a.id, 'provider', a.provider, 'label', a.label,
           'config', a.config, 'is_default', a.is_default,
           'has_credential', a.credential_enc IS NOT NULL,
           'apps_using', (SELECT count(*) FROM tenant_providers tp WHERE tp.provider_account_id = a.id),
           'created_at', a.created_at
         ) ORDER BY a.provider, a.is_default DESC, a.label), '[]'::jsonb)
  FROM provider_accounts a
  WHERE a.owner_user_id = auth.uid()
    AND (p_provider IS NULL OR a.provider = p_provider);
$$;
COMMENT ON FUNCTION public.provider_accounts_list(TEXT) IS
  'Account provider connections for the caller, credentials masked (has_credential only) + how many apps use each.';

-- ── 5. Write — create or update a connection ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.provider_accounts_save(
    p_id         UUID,
    p_provider   TEXT,
    p_label      TEXT,
    p_credential TEXT DEFAULT NULL,
    p_config     JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id UUID; v_first BOOLEAN;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF COALESCE(p_label,'') = '' THEN
    -- Unlabelled connections are indistinguishable in a picker, which is the whole point of having
    -- more than one.
    RAISE EXCEPTION 'label required' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- An app id belongs to an APP, not to a credential. Accepting it here is how the two scopes got
  -- mixed in the first place.
  IF p_config ?| ARRAY['package_name','bundle_id'] THEN
    RAISE EXCEPTION 'package_name/bundle_id are per-app; set them on the app, not the connection'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_id IS NULL THEN
    v_first := NOT EXISTS (SELECT 1 FROM provider_accounts
                           WHERE owner_user_id = auth.uid() AND provider = p_provider);
    INSERT INTO provider_accounts (owner_user_id, provider, label, credential_enc, config, is_default)
    VALUES (auth.uid(), p_provider, p_label,
            CASE WHEN COALESCE(p_credential,'') = '' THEN NULL
                 ELSE encrypt_provider_key(p_credential) END,
            COALESCE(p_config,'{}'::jsonb),
            v_first)            -- the first connection for a provider is the default
    RETURNING id INTO v_id;
  ELSE
    UPDATE provider_accounts SET
      label          = p_label,
      -- Blank credential means "keep the current key" so an operator can rename or re-configure
      -- without re-pasting a secret they may not have to hand.
      credential_enc = CASE WHEN COALESCE(p_credential,'') = '' THEN credential_enc
                           ELSE encrypt_provider_key(p_credential) END,
      config         = COALESCE(p_config, config),
      updated_at     = now()
    WHERE id = p_id AND owner_user_id = auth.uid()
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
      RAISE EXCEPTION 'no such connection for this account' USING ERRCODE = 'no_data_found';
    END IF;
  END IF;
  RETURN v_id;
END;
$$;

-- ── 6. Default ────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.provider_accounts_set_default(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_provider TEXT;
BEGIN
  SELECT provider INTO v_provider FROM provider_accounts
  WHERE id = p_id AND owner_user_id = auth.uid();
  IF v_provider IS NULL THEN
    RAISE EXCEPTION 'no such connection for this account' USING ERRCODE = 'no_data_found';
  END IF;
  -- Clear first: the partial unique index allows exactly one default per (owner, provider), so
  -- setting the new one before clearing the old would violate it.
  UPDATE provider_accounts SET is_default = false, updated_at = now()
  WHERE owner_user_id = auth.uid() AND provider = v_provider AND is_default;
  UPDATE provider_accounts SET is_default = true, updated_at = now() WHERE id = p_id;
  RETURN true;
END;
$$;

-- ── 7. Attach a connection to an app ──────────────────────────────────────────────────────────
-- `p_account_id = NULL` detaches, which means "follow the account default" rather than "no billing".
CREATE OR REPLACE FUNCTION public.tenant_provider_attach(
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
  IF NOT EXISTS (SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Only a connection the caller owns. Without this an admin of one app could point it at someone
  -- else's credential by id and bill through their store account.
  IF p_account_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM provider_accounts
      WHERE id = p_account_id AND owner_user_id = auth.uid() AND provider = p_provider) THEN
    RAISE EXCEPTION 'no such connection for this account' USING ERRCODE = 'no_data_found';
  END IF;

  INSERT INTO tenant_providers (tenant_id, provider, provider_account_id, store_config, is_active)
  VALUES (p_tenant, p_provider, p_account_id, COALESCE(p_app_config,'{}'::jsonb), true)
  ON CONFLICT (tenant_id, provider) DO UPDATE
    SET provider_account_id = EXCLUDED.provider_account_id,
        store_config        = COALESCE(p_app_config, tenant_providers.store_config),
        updated_at          = now();
  RETURN true;
END;
$$;

-- ── 8. Resolve — what this app actually bills through ─────────────────────────────────────────
-- The explicit attachment wins; otherwise the account default. Returns the CONNECTION (masked) plus
-- the app's own ids, so a caller sees both halves of the split without re-joining them by hand.
CREATE OR REPLACE FUNCTION public.tenant_provider_resolve(p_tenant UUID, p_provider TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_owner UUID; v_tp RECORD; v_acct RECORD;
BEGIN
  SELECT * INTO v_tp FROM tenant_providers
  WHERE tenant_id = p_tenant AND provider = p_provider;

  -- WHO is "the account"? The first draft said "the oldest tenant_admins row", which is wrong the
  -- moment an app has more than one admin: a team app resolved to the earliest-added teammate, who
  -- owns no connections, and the app fell back to NO provider at all — silently. Caught by a test
  -- whose tenant had an extra admin row.
  --
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

REVOKE ALL ON FUNCTION public.provider_accounts_list(TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.provider_accounts_save(UUID, TEXT, TEXT, TEXT, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.provider_accounts_set_default(UUID) FROM anon;
REVOKE ALL ON FUNCTION public.tenant_provider_attach(UUID, TEXT, UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.tenant_provider_resolve(UUID, TEXT) FROM anon;
GRANT EXECUTE ON FUNCTION public.provider_accounts_list(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.provider_accounts_save(UUID, TEXT, TEXT, TEXT, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.provider_accounts_set_default(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_provider_attach(UUID, TEXT, UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_provider_resolve(UUID, TEXT) TO authenticated, service_role;
