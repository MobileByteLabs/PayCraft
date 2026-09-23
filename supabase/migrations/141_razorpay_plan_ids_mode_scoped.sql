-- 141_razorpay_plan_ids_mode_scoped.sql
--
-- Mode-scope Razorpay plan ids. This is a LIVE-BILLING correctness fix, not a test-mode nicety.
--
-- THE BUG
-- `tenant_products.razorpay_plan_id_by_currency` is a single column, written by whichever sync mode
-- ran last. `runProductSync` syncs EVERY configured mode in one pass — live, then test — and records
-- "the last successful sync's ids". So on any tenant with both keys configured, a routine sync ends
-- with a TEST plan id sitting in the field the LIVE checkout reads:
--
--   dashboard/lib/checkout-initiator.ts:259
--     const planId = req.product.razorpay_plan_id_by_currency?.["INR"]
--
-- That path already knows its mode (`mode: "test" | "live"`) and still had one place to read from.
-- A real customer checking out in live mode could therefore be handed a test-mode plan: Razorpay
-- rejects it, and the failure looks like a payment problem rather than a data problem.
--
-- It also made test readiness unprovable, which is how it was found — PayCraft could see three plans
-- and could not say which mode they belonged to.
--
-- THE SHAPE
-- A second column rather than a restructure of the first. `tenant_providers` already models this
-- exactly this way (`live_payment_links` / `test_payment_links`), so this matches the house pattern
-- and, more importantly, does not rewrite a column that live checkout reads on every purchase.
--
-- WHAT HAPPENS TO THE EXISTING VALUES
-- They are UNATTRIBUTABLE — nothing recorded which mode wrote them — so they are neither trusted as
-- live nor deleted:
--   • left in place, because clearing them would break live checkout in the window before the next
--     sync, trading a latent risk for a certain outage;
--   • the next LIVE sync overwrites the column with a verified live plan id, and the next TEST sync
--     fills the new column, after which both are correct by construction.
-- One full sync converges. Until then `live_plan_ids_verified` stays false and readiness says so
-- rather than showing a green verdict it cannot support.

BEGIN;

ALTER TABLE tenant_products
  ADD COLUMN IF NOT EXISTS razorpay_plan_id_by_currency_test JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Distinguishes "a live sync wrote this" from "something wrote this before 141". Without it the
  -- ambiguous legacy values are indistinguishable from verified ones the moment this ships.
  ADD COLUMN IF NOT EXISTS live_plan_ids_verified BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN tenant_products.razorpay_plan_id_by_currency IS
  'LIVE-mode Razorpay plan ids, {currency: plan_id}. Before migration 141 this column was written by '
  'whichever sync mode ran last, so rows with live_plan_ids_verified = false may hold TEST plan ids.';
COMMENT ON COLUMN tenant_products.razorpay_plan_id_by_currency_test IS
  'TEST-mode Razorpay plan ids, {currency: plan_id}. Added by 141; the live twin is the column above.';

-- The setter gains a mode. The old two-argument version is DROPPED rather than left as an overload:
-- keeping it would let any caller that was not updated keep writing the live column from a test
-- sync, which is the exact defect being fixed, and PostgREST would resolve to it silently.
DROP FUNCTION IF EXISTS public.tenant_products_set_razorpay_ids(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.tenant_products_set_razorpay_ids(
  p_id   UUID,
  p_razorpay_plan_id_by_currency JSONB,
  p_mode TEXT
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
    -- wrong guess is precisely what put test plan ids in front of live customers.
    RAISE EXCEPTION 'invalid_mode:%', p_mode;
  END IF;

  IF p_mode = 'live' THEN
    UPDATE tenant_products
       SET razorpay_plan_id_by_currency = p_razorpay_plan_id_by_currency,
           live_plan_ids_verified = TRUE,
           updated_at = now()
     WHERE id = p_id;
  ELSE
    UPDATE tenant_products
       SET razorpay_plan_id_by_currency_test = p_razorpay_plan_id_by_currency,
           updated_at = now()
     WHERE id = p_id;
  END IF;
END;
$function$;

REVOKE ALL ON FUNCTION public.tenant_products_set_razorpay_ids(UUID, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_products_set_razorpay_ids(UUID, JSONB, TEXT)
  TO authenticated, service_role;

COMMIT;
