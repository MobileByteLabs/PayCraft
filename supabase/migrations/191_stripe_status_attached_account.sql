-- 191_stripe_status_attached_account.sql
--
-- `tenant_stripe_provider_status` answered "not connected" for every app whose Stripe credential comes
-- from an ATTACHED provider account (tenant_providers.provider_account_id — the pinned → own → default
-- ladder of migration 113) rather than keys pasted into the app's own row. It only looked at
-- tenant_providers.{live,test}_key_id, which an attached app never fills.
--
-- Everything else on the path already resolves the attached account: checkout-initiate and
-- tenant_providers_decrypt_key go through tenant_psp_credential_resolve, and tenant_providers_status
-- reports the account's key ids. Only this gate disagreed, and it is the one the product sync asks
-- first — so `stripeSyncProduct` skipped every product with "Stripe is not connected" while readiness
-- reported a live credential.
--
-- Measured on ReelExport (com.reelexport.web) 2026-11-13: this function returned 0 rows while
-- tenant_psp_credential_resolve returned a live and a test secret; sync run
-- 9c3282a7-bde7-4a91-b6f1-94356f0054bf skipped all 5 products, so no USD subscription was purchasable.
--
-- The fix resolves exactly like checkout does. OAuth (Connect) still wins when present; the shape of
-- the result is unchanged (source, account_id, livemode), so callers need no change.

CREATE OR REPLACE FUNCTION public.tenant_stripe_provider_status(p_tenant_id uuid)
 RETURNS TABLE(source text, account_id text, livemode boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_live RECORD;
  v_test RECORD;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Prefer the OAuth row when both exist (Connect platform mode is the "official" production setup).
  IF EXISTS (SELECT 1 FROM tenant_stripe_connect WHERE tenant_id = p_tenant_id) THEN
    RETURN QUERY
    SELECT 'oauth'::TEXT, t.stripe_account_id, t.livemode
    FROM tenant_stripe_connect t WHERE t.tenant_id = p_tenant_id;
    RETURN;
  END IF;

  -- Keys: the app's own, an attached account, or the owner's default — the same resolution
  -- checkout-initiate and tenant_providers_decrypt_key use. Live takes precedence over test.
  SELECT * INTO v_live FROM tenant_psp_credential_resolve(p_tenant_id, 'stripe', 'live') LIMIT 1;
  SELECT * INTO v_test FROM tenant_psp_credential_resolve(p_tenant_id, 'stripe', 'test') LIMIT 1;

  IF v_live.secret_key IS NULL AND v_test.secret_key IS NULL THEN
    RETURN;   -- genuinely not connected
  END IF;

  RETURN QUERY SELECT
    'manual'::TEXT,
    COALESCE(CASE WHEN v_live.secret_key IS NOT NULL THEN v_live.key_id END, v_test.key_id),
    (v_live.secret_key IS NOT NULL);
END;
$function$;
