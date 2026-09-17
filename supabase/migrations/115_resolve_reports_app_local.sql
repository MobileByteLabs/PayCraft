-- 115_resolve_reports_app_local.sql
--
-- `tenant_provider_resolve` must report an app's OWN credential as connected.
--
-- It defines `connected` as "an account row exists and holds a credential", which was true when
-- 103 wrote it — every store app had been backfilled onto an account, so nothing else existed to
-- miss. 113 then made app-local credentials a first-class rung of the precedence ladder, and 112
-- brought in the PSPs, which were never backfilled at all: their keys still sit on
-- `tenant_providers.{test,live}_secret_key_enc`. So resolve fell out of step with the function that
-- actually hands out the credential.
--
-- Caught on a production mirror, which is the only place it could show: "Reels Downloader" bills
-- through Stripe today — `tenant_providers_decrypt_key` returns its secret — while
-- `tenant_providers_resolved_list` reported `stripe connected=false`. The providers index would
-- have shown "Set up" on a live, paying integration, and the connection picker told the operator
-- "This app has no credential for this provider yet" on the same page that said "Stripe is
-- connected". Two truths on one screen, and the wrong one was mine.
--
-- The fix keeps one definition of connected for the whole tier: an app is connected when the thing
-- that resolves its credential would return one. That is the account when pinned or inherited, and
-- otherwise the app's own key.
--
-- Adds `source` ∈ {account, app, none} so the UI can say WHICH, instead of leaving a reader to infer
-- it from `via_default` — which cannot distinguish "its own key" from "nothing at all".

CREATE OR REPLACE FUNCTION public.tenant_provider_resolve(p_tenant UUID, p_provider TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner     UUID;
  v_tp        RECORD;
  v_acct      RECORD;
  v_use_acct  BOOLEAN := true;
  v_has_local BOOLEAN;
  v_on_acct   BOOLEAN;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO v_tp FROM tenant_providers
  WHERE tenant_id = p_tenant AND provider = p_provider;

  -- Any credential the app holds itself: a store blob, or either PSP mode. `tenant_providers` is
  -- one table for both kinds, so both have to be asked about here or one of them silently reads as
  -- unconfigured.
  v_has_local := COALESCE(v_tp.store_credential_enc  IS NOT NULL, false)
              OR COALESCE(v_tp.test_secret_key_enc   IS NOT NULL, false)
              OR COALESCE(v_tp.live_secret_key_enc   IS NOT NULL, false);

  SELECT u.id INTO v_owner
  FROM tenants t JOIN auth.users u ON lower(u.email) = lower(t.owner_email)
  WHERE t.id = p_tenant LIMIT 1;
  IF v_owner IS NULL THEN
    SELECT user_id INTO v_owner FROM tenant_admins
    WHERE tenant_id = p_tenant ORDER BY created_at LIMIT 1;
  END IF;

  -- Same ladder as 113: pinned → the app's own → the account default.
  IF v_tp.provider_account_id IS NOT NULL THEN
    SELECT * INTO v_acct FROM provider_accounts WHERE id = v_tp.provider_account_id;
  ELSIF v_has_local THEN
    v_use_acct := false;
    -- Assign the record to an empty row: a plpgsql RECORD left unassigned raises 55000 on field
    -- access, and the guard flag below is one SQL expression, so it does not short-circuit.
    SELECT * INTO v_acct FROM provider_accounts WHERE false;
  ELSE
    SELECT a.* INTO v_acct
    FROM provider_accounts a
    WHERE a.provider = p_provider AND a.is_default
      AND a.owner_user_id IN (SELECT user_id FROM tenant_admins WHERE tenant_id = p_tenant)
    ORDER BY (a.owner_user_id = v_owner) DESC, a.created_at
    LIMIT 1;
  END IF;

  v_on_acct := v_use_acct AND v_acct.id IS NOT NULL AND v_acct.credential_enc IS NOT NULL;

  RETURN jsonb_build_object(
    'provider',    p_provider,
    -- Connected means: the resolver would hand out a credential.
    'connected',   v_on_acct OR v_has_local,
    'source',      CASE WHEN v_on_acct THEN 'account' WHEN v_has_local THEN 'app' ELSE 'none' END,
    'account_id',  CASE WHEN v_on_acct THEN v_acct.id ELSE NULL END,
    'label',       CASE WHEN v_on_acct THEN v_acct.label ELSE NULL END,
    -- Only an INHERITED account counts as via_default. An app on its own key is not following
    -- anything, and reporting it as such would invite an operator to "fix" a default that has no
    -- bearing on this app.
    'via_default', v_on_acct AND v_tp.provider_account_id IS NULL,
    'config',      CASE WHEN v_on_acct THEN COALESCE(v_acct.config,'{}'::jsonb) ELSE '{}'::jsonb END,
    'app_config',  COALESCE(v_tp.store_config,'{}'::jsonb)
  );
END;
$$;

COMMENT ON FUNCTION public.tenant_provider_resolve(UUID, TEXT) IS
  'What this app bills through: pinned account → its own credential → account default. connected mirrors what the credential resolvers would return; source says which rung answered.';

REVOKE ALL ON FUNCTION public.tenant_provider_resolve(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_provider_resolve(UUID, TEXT) TO authenticated, service_role;
