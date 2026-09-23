-- 138_status_rpcs_allow_service_role.sql
--
-- Let the SERVICE ROLE read provider status. Without this the management API syncs the wrong modes
-- and reports success.
--
-- WHAT WENT WRONG, MEASURED
-- `POST /api/v1/sync` authenticates with an API key and therefore runs as service_role. Inside,
-- `stripeSyncProduct` asks `tenant_providers_status` which MODES are configured, and
-- `razorpaySyncProduct` asks the same RPC whether the provider is connected at all. Both functions
-- gate on `auth.uid() IN tenant_admins`, and service_role has no uid — so both raised `forbidden`.
--
-- Neither call surfaced it. Each destructures `{ data }` and drops `error`, so:
--   • Stripe saw `keyStatus = null`, computed `modes = []`, fell back to live-only, and synced 3
--     products while creating ZERO test links — then reported "synced: 3".
--   • Razorpay saw `rpStatus = null` and returned "Razorpay is not connected for this tenant",
--     naming the wrong cause entirely: the account is connected and carries both keys.
--
-- A drain that silently syncs half of what it was asked to is worse than one that fails, because
-- the readiness it was run to fix stays red with nothing explaining why.
--
-- WHY A SERVICE-ROLE BRANCH IS THE RIGHT FIX
-- Same reasoning as 136 and 137: service_role already bypasses RLS and can read `tenant_providers`
-- and `provider_accounts` directly, so this grants no new power — it lets the machine path reach
-- the SAME resolved answer the human path gets, instead of a degraded one. `tenant_provider_resolve`
-- is included because the status RPCs delegate to it and it carries the identical guard, so
-- widening only the callers would leave them failing one level down.
--
-- The `authenticated` path is untouched: a logged-in non-admin is still refused.

-- ── tenant_provider_resolve ──
CREATE OR REPLACE FUNCTION public.tenant_provider_resolve(p_tenant uuid, p_provider text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_owner     UUID;
  v_tp        RECORD;
  v_acct      RECORD;
  v_use_acct  BOOLEAN := true;
  v_has_local BOOLEAN;
  v_on_acct   BOOLEAN;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (
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
$function$;
-- ── tenant_providers_status ──
CREATE OR REPLACE FUNCTION public.tenant_providers_status(p_tenant_id uuid, p_provider text)
 RETURNS TABLE(test_key_id text, live_key_id text, connected boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_res JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- One definition for the whole tier. tenant_provider_resolve carries the same admin guard, so
  -- this cannot widen access; it re-checks the caller it was already handed.
  v_res := tenant_provider_resolve(p_tenant_id, p_provider);

  RETURN QUERY
  SELECT
    -- Prefer the rung that actually resolved. An account-attached app keeps its key ids in
    -- provider_accounts.config; an app on its own credential keeps them on the row.
    CASE WHEN v_res->>'source' = 'account'
         THEN COALESCE(v_res->'config'->>'test_key_id', tp.test_key_id)
         ELSE tp.test_key_id END,
    CASE WHEN v_res->>'source' = 'account'
         THEN COALESCE(v_res->'config'->>'live_key_id', tp.live_key_id)
         ELSE tp.live_key_id END,
    COALESCE((v_res->>'connected')::boolean, false)
  FROM tenant_providers tp
  WHERE tp.tenant_id = p_tenant_id
    AND tp.provider  = p_provider
    AND tp.is_active;
END;
$function$;
-- ── tenant_providers_store_status ──
CREATE OR REPLACE FUNCTION public.tenant_providers_store_status(p_tenant_id uuid, p_provider text)
 RETURNS TABLE(connected boolean, config jsonb)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tp       RECORD;
  v_acct     RECORD;
  v_owner    UUID;
  v_conn     BOOLEAN;
  v_acct_cfg JSONB := '{}'::jsonb;
  v_use_acct BOOLEAN := true;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (
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
$function$;
