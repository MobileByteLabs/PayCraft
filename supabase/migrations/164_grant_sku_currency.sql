-- 164 — a product grants units of a CURRENCY, which is not the same thing as the product.
--
-- THE GAP
-- Every credit path writes `entitlement_balance_ledger.sku = <the product's own sku>`. For a single
-- consumable that is right. For a CURRENCY sold in several sizes it is not: three coin packs
--
--     cappy_ripples_300  -> 300 units of sku 'cappy_ripples_300'
--     cappy_ripples_800  -> 800 units of sku 'cappy_ripples_800'
--     cappy_ripples_1800 -> 1800 units of sku 'cappy_ripples_1800'
--
-- produce THREE separate balances, none of which is "how many Ripples do I have". The user buys a
-- bigger pack and their coins do not add up. Spending is worse: the host would have to pick which
-- pack's balance to debit and handle the case where no single one covers the price.
--
-- Found by wiring the first real consumer (mbs/cappy, 2026-10-22) rather than by review — the
-- single-pack case this was built against never exposed it.
--
-- THE FIX
-- `grant_sku` names the currency a product credits. It defaults to the product's own sku, so every
-- existing row keeps its exact current behaviour and no deployed app changes meaning. A family of
-- packs sets all of them to one shared currency id, and the balance finally adds up.
--
--     cappy_ripples_300 / _800 / _1800   grant_sku = 'ripples'
--     ad reward                          sku       = 'ripples'
--     focus-session activity earn        sku       = 'ripples'
--     spend a cosmetic                   sku       = 'ripples'
--
-- The currency id is NOT itself a product and deliberately has no row in tenant_products: it is a
-- ledger partition key, and requiring a product row for it would mean inventing a sellable thing
-- nobody sells. The consequence is that `daily_earn_cap` and `ad_reward_quantity` — which are read
-- per-sku — must be declared on a row whose `grant_sku` IS that currency; the helpers below resolve
-- a currency back to its configuring product so a caller never has to know which one.
--
-- Idempotent.

ALTER TABLE public.tenant_products
  ADD COLUMN IF NOT EXISTS grant_sku TEXT;

COMMENT ON COLUMN public.tenant_products.grant_sku IS
  'The CURRENCY this product credits, when it is not the product itself. NULL (default) means the '
  'product''s own sku — unchanged behaviour. Several pack sizes of one currency share a value here '
  'so their balances add up instead of being three unrelated numbers.';

-- ── resolve a product to the currency it credits ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.entitlement_currency_of(
    p_tenant_id UUID,
    p_sku       TEXT
)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(btrim(grant_sku), ''), sku)
  FROM tenant_products
  WHERE tenant_id = p_tenant_id AND sku = p_sku
  LIMIT 1;
$$;

-- ── which product carries the earn/ad configuration for a CURRENCY ─────────────────────────────
-- A currency has no product row of its own, so "what is the daily cap for 'ripples'" has to resolve
-- through whichever product declares it. Deterministic by sku so two configuring rows cannot make
-- the answer depend on insert order; a tenant that declares conflicting caps gets the first by name
-- and that is a configuration error to surface, not a coin flip to hide.
CREATE OR REPLACE FUNCTION public.entitlement_currency_config(
    p_tenant_id UUID,
    p_currency  TEXT
)
RETURNS TABLE (daily_earn_cap INT, ad_reward_quantity INT, daily_ad_reward_cap INT)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tp.daily_earn_cap, tp.ad_reward_quantity, tp.daily_ad_reward_cap
  FROM tenant_products tp
  WHERE tp.tenant_id = p_tenant_id
    AND tp.active
    AND COALESCE(NULLIF(btrim(tp.grant_sku), ''), tp.sku) = p_currency
    AND (tp.daily_earn_cap IS NOT NULL
         OR tp.ad_reward_quantity IS NOT NULL
         OR tp.daily_ad_reward_cap IS NOT NULL)
  ORDER BY tp.sku
  LIMIT 1;
$$;

-- ── the activity earn now reads its cap through the currency ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.entitlement_balance_earn(
    p_server_token    TEXT,
    p_api_key         TEXT,
    p_sku             TEXT,
    p_quantity        INT,
    p_idempotency_key TEXT
)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant   UUID;
  v_subject  UUID;
  v_cap      INT;
  v_earned   INT;
  v_grant    INT;
BEGIN
  IF p_quantity IS NULL OR p_quantity < 1 THEN
    RAISE EXCEPTION 'quantity must be >= 1' USING ERRCODE = 'check_violation';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key is required' USING ERRCODE = 'null_value_not_allowed';
  END IF;

  v_tenant := resolve_tenant(p_api_key);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'unknown or inactive api key' USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  v_subject := entitlement_subject_of_verified_token(p_server_token, v_tenant);
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'unknown or inactive device token' USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  -- p_sku is the CURRENCY here, not a product. Read the cap from whichever product declares it.
  SELECT c.daily_earn_cap INTO v_cap
  FROM entitlement_currency_config(v_tenant, p_sku) c;

  IF v_cap IS NULL THEN
    RAISE EXCEPTION
      'currency % does not allow activity earning (set daily_earn_cap on a product whose grant_sku is %)',
      p_sku, p_sku
      USING ERRCODE = 'check_violation';
  END IF;

  v_earned := entitlement_activity_earned_today(v_tenant, v_subject, p_sku);
  v_grant  := LEAST(p_quantity, GREATEST(v_cap - v_earned, 0));

  IF v_grant > 0 THEN
    INSERT INTO entitlement_balance_ledger
      (tenant_id, subject_id, sku, delta, reason, stable_txn_id, idempotency_key)
    VALUES
      (v_tenant, v_subject, p_sku, v_grant, 'activity', NULL, btrim(p_idempotency_key))
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;
  END IF;

  RETURN public.entitlement_balance_get(p_api_key, v_subject, p_sku);
END;
$$;

GRANT EXECUTE ON FUNCTION public.entitlement_balance_earn(TEXT, TEXT, TEXT, INT, TEXT) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.entitlement_currency_of(UUID, TEXT)     FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.entitlement_currency_of(UUID, TEXT)     TO service_role;
REVOKE EXECUTE ON FUNCTION public.entitlement_currency_config(UUID, TEXT) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.entitlement_currency_config(UUID, TEXT) TO service_role;
