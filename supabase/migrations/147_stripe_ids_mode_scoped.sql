-- 147_stripe_ids_mode_scoped.sql
--
-- Mode-scope Stripe product + price ids. This is migration 141 applied to the provider 141 did not
-- cover. Same bug, same shape, same reasoning — Razorpay got the fix on 2026-09-2x and Stripe was
-- left on the broken pattern.
--
-- THE BUG
-- `tenant_products.stripe_product_id` and `.stripe_price_id_by_currency` are single columns, written
-- by whichever sync mode ran last. `runProductSync` → `stripeSyncProduct` syncs EVERY configured
-- mode in one pass, and `modes` is built live-first:
--
--   dashboard/lib/stripe-route-helper.ts
--     const modes = [live?, test?].filter(Boolean)   -- live, then TEST
--     for (const mode of modes) { ... lastResult = result }
--     await supabase.rpc("tenant_products_set_stripe_ids", { ...lastResult })
--
-- The comment at that call site said it records "the last successful sync's ids, preferring live" —
-- but `lastResult` is the LAST iteration, and test is last. So on any tenant with both keys
-- configured, a routine sync ends with a TEST product and TEST price ids sitting in the fields LIVE
-- checkout reads (`supabase/functions/config/index.ts` → `stripe_price_id_by_currency`).
--
-- MEASURED, not inferred (2026-10-06). Tenants cappy and reels-downloader, 7 products, every one
-- unreadable with the tenant's live key. Stripe's own answer, once the readback stopped discarding
-- it:
--
--   No such product: 'prod_VJMNS10q3sZyzF'; a similar object exists in test mode,
--   but a live mode key was used to make this request
--
-- Live Stripe checkout on both apps was pointed at test-mode objects. It presented as a drift
-- warning; it is a revenue outage.
--
-- THE SHAPE
-- A second pair of columns rather than a restructure of the first — exactly 141, which in turn
-- matches how `tenant_providers` has always modelled this (`live_payment_links` /
-- `test_payment_links`). It does not rewrite the columns live checkout reads on every purchase.
--
-- WHAT HAPPENS TO THE EXISTING VALUES
-- They are UNATTRIBUTABLE — nothing recorded which mode wrote them — so, per 141, they are neither
-- trusted as live nor deleted:
--   • left in place, because clearing them would break live checkout in the window before the next
--     sync for every row that DOES hold a live id, trading a latent risk for a certain outage;
--   • the next LIVE sync overwrites them with verified live ids, and the next TEST sync fills the
--     new columns, after which both are correct by construction.
-- One full sync converges. Until then `live_stripe_ids_verified` stays false, and a consumer that
-- needs a trustworthy answer reads the flag rather than the column.
--
-- Note the difference from 141, stated because it is tempting to act on: for cappy and
-- reels-downloader we have PROOF the current values are test-mode, so "latent risk" is already a
-- live break there. Clearing them is still not this migration's job — it cannot prove the same for
-- every other row, and a targeted repair is a backfill decision for an operator with the drift
-- report in hand, not a schema change. The flag is what makes those rows identifiable.

BEGIN;

ALTER TABLE tenant_products
  ADD COLUMN IF NOT EXISTS stripe_product_id_test TEXT,
  ADD COLUMN IF NOT EXISTS stripe_price_id_by_currency_test JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Distinguishes "a live sync wrote this" from "something wrote this before 147". Without it the
  -- ambiguous legacy values are indistinguishable from verified ones the moment this ships.
  ADD COLUMN IF NOT EXISTS live_stripe_ids_verified BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN tenant_products.stripe_product_id IS
  'LIVE-mode Stripe Product id (prod_...). Before migration 147 this column was written by '
  'whichever sync mode ran last, so rows with live_stripe_ids_verified = false may hold a TEST id.';
COMMENT ON COLUMN tenant_products.stripe_price_id_by_currency IS
  'LIVE-mode Stripe Price ids, {currency: price_id}. See the caveat on stripe_product_id — rows '
  'with live_stripe_ids_verified = false may hold TEST price ids.';
COMMENT ON COLUMN tenant_products.stripe_product_id_test IS
  'TEST-mode Stripe Product id. Added by 147; the live twin is stripe_product_id.';
COMMENT ON COLUMN tenant_products.stripe_price_id_by_currency_test IS
  'TEST-mode Stripe Price ids, {currency: price_id}. Added by 147; live twin is stripe_price_id_by_currency.';
COMMENT ON COLUMN tenant_products.live_stripe_ids_verified IS
  'TRUE once a LIVE-mode Stripe sync wrote stripe_product_id / stripe_price_id_by_currency. FALSE '
  'means the values predate 147 and their mode is unknown — they may be test-mode ids.';

-- The setter gains a mode. The old three-argument version is DROPPED rather than left as an
-- overload: keeping it would let any caller that was not updated keep writing the live columns from
-- a test sync — the exact defect being fixed — and PostgREST would resolve to it silently.
DROP FUNCTION IF EXISTS public.tenant_products_set_stripe_ids(uuid, text, jsonb);

CREATE OR REPLACE FUNCTION public.tenant_products_set_stripe_ids(
  p_id                          UUID,
  p_stripe_product_id           TEXT,
  p_stripe_price_id_by_currency JSONB,
  p_mode                        TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_tenant FROM tenant_products WHERE id = p_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'unknown_product'; END IF;

  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (
       SELECT 1 FROM tenant_admins WHERE tenant_id = v_tenant AND user_id = auth.uid()
     ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF p_mode NOT IN ('live', 'test') THEN
    -- No default. A caller that does not know its mode must not be allowed to guess, because the
    -- wrong guess is precisely what put test product ids in front of live customers.
    RAISE EXCEPTION 'invalid_mode:%', p_mode;
  END IF;

  IF p_mode = 'live' THEN
    UPDATE tenant_products
       SET stripe_product_id           = p_stripe_product_id,
           stripe_price_id_by_currency = p_stripe_price_id_by_currency,
           live_stripe_ids_verified    = TRUE,
           updated_at                  = now()
     WHERE id = p_id;
  ELSE
    UPDATE tenant_products
       SET stripe_product_id_test           = p_stripe_product_id,
           stripe_price_id_by_currency_test = p_stripe_price_id_by_currency,
           updated_at                       = now()
     WHERE id = p_id;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.tenant_products_set_stripe_ids(UUID, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_products_set_stripe_ids(UUID, TEXT, JSONB, TEXT)
  TO authenticated, service_role;

COMMIT;
