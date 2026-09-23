-- 132_provider_status_account_aware.sql
--
-- `tenant_providers_status.connected` must agree with `tenant_provider_resolve`.
--
-- THE THIRD DEFINITION OF "CONNECTED".
-- 110 and 115 already settled this question once. 115: "an app is connected when the thing that
-- resolves its credential would return one — the account when pinned or inherited, and otherwise
-- the app's own key". 110 then built the list view on top of that same function precisely "so the
-- list and the detail view cannot drift into disagreeing about what is connected".
--
-- 121 — written AFTER both — did not get the memo. It fixed a real bug (a live-only tenant read as
-- disconnected because `connected` meant "has a TEST key id") but kept reading the columns on
-- `tenant_providers`:
--
--     (live_key_id IS NOT NULL AND live_secret_key_enc IS NOT NULL)
--  OR (test_key_id IS NOT NULL AND test_secret_key_enc IS NOT NULL)
--
-- Those columns are NULL for every app whose credential lives on a provider_account — which is the
-- normal, recommended shape ("an operator running six apps off one Play console connects it once").
-- So the status RPC reports a live, correctly-attached provider as NOT CONNECTED.
--
-- MEASURED, production tenant cappy (ba973ad0…) on 2026-09-20:
--   razorpay    → provider_account_id=b9b79c8e… (label rzp_live…, credential_enc SET)
--                 live_key_id NULL, test_key_id NULL  → status.connected = FALSE
--   app_store   → provider_account_id=5e836d3b… (credential_enc SET), key columns NULL → FALSE
--   stripe      → attached AND carrying live_key_id on the row → TRUE
--
-- Stripe passing is what made this hard to see: the sync worked for one provider and "was not
-- connected" for another, on the same healthy tenant.
--
-- CONSEQUENCE. `razorpaySyncProduct` gates on this RPC and returns
-- `Razorpay is not connected for this tenant`, so /api/sync/all skips every razorpay product. The
-- drift detector then reports `active-provider-zero-links` whose hint is "sync products to
-- razorpay" — the very thing that just skipped. The finding could never clear, which is the exact
-- failure 121's own header describes and the one drift-detectors.ts warns about: "a finding no
-- action can clear trains the operator to ignore the banner".
--
-- FIX: delegate. `connected` is whatever the resolver says, and the key ids come from whichever
-- rung actually answered — the account's config when it resolved to an account, else the app's own
-- columns. Callers use those ids to choose which MODES to sync (`live_key_id ? "live" : "test"` in
-- stripe-route-helper), so returning the row's NULLs for an account-attached provider would push a
-- live account's products in TEST mode. Preserving the mode signal is part of the fix, not a bonus.
--
-- Deliberately unchanged: the `is_active` filter. An inactive provider still returns NO ROW, which
-- every caller already reads as "not connected" via `rpStatus?.connected`.

CREATE OR REPLACE FUNCTION public.tenant_providers_status(p_tenant_id uuid, p_provider text)
RETURNS TABLE(test_key_id text, live_key_id text, connected boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_res JSONB;
BEGIN
  IF NOT EXISTS (
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

REVOKE EXECUTE ON FUNCTION public.tenant_providers_status(uuid, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.tenant_providers_status(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.tenant_providers_status(uuid, text) IS
  'Per-provider connection status. connected DELEGATES to tenant_provider_resolve (115) so the '
  'status RPC, the detail view and the providers index share one definition; key ids come from the '
  'rung that resolved (account config, else the app row) so callers pick the right MODE. '
  'Superseded migration 121, which read tenant_providers columns only and therefore reported every '
  'account-attached provider as disconnected.';
