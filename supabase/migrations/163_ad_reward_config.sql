-- 163 — per-sku ad-reward configuration.
--
-- The `ad-reward` edge function must decide HOW MUCH a watched ad is worth, and the only safe place
-- for that is the catalogue. AdMob's callback carries a `reward_amount`, but it is configured in
-- the AdMob console — outside this system, changeable by anyone with console access, and attacker-
-- adjacent for a self-hosted deployment. Taking it verbatim would let an ad-unit misconfiguration
-- set the price of the tenant's currency.
--
-- Same discipline as `grant_quantity` for purchases (157) and `daily_earn_cap` for activity (161):
-- the payload says WHAT HAPPENED, the catalogue says WHAT IT IS WORTH.
--
-- NULL/0 = ad rewards are DISABLED for this sku, which is the default for every existing row. A
-- tenant opts in deliberately, because enabling it turns watched attention into currency.
--
-- Idempotent.

ALTER TABLE public.tenant_products
  ADD COLUMN IF NOT EXISTS ad_reward_quantity INT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_products_ad_reward_quantity_positive'
  ) THEN
    ALTER TABLE public.tenant_products
      ADD CONSTRAINT tenant_products_ad_reward_quantity_positive
      CHECK (ad_reward_quantity IS NULL OR ad_reward_quantity >= 1);
  END IF;
END $$;

COMMENT ON COLUMN public.tenant_products.ad_reward_quantity IS
  'Units credited per VERIFIED rewarded-ad view (reason=ad_reward). NULL/0 disables ad rewards for '
  'this sku — the default. Deliberately NOT read from the ad network''s callback: reward_amount is '
  'configured in the ad console, outside this system, so trusting it would let that console set the '
  'price of this currency.';

-- A daily ceiling for ad rewards too. Without one, an automated viewer farms currency at whatever
-- rate the ad network will serve — the activity cap's exact problem, with a different mint.
ALTER TABLE public.tenant_products
  ADD COLUMN IF NOT EXISTS daily_ad_reward_cap INT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_products_daily_ad_reward_cap_positive'
  ) THEN
    ALTER TABLE public.tenant_products
      ADD CONSTRAINT tenant_products_daily_ad_reward_cap_positive
      CHECK (daily_ad_reward_cap IS NULL OR daily_ad_reward_cap >= 1);
  END IF;
END $$;

COMMENT ON COLUMN public.tenant_products.daily_ad_reward_cap IS
  'Max units creditable by reason=ad_reward per subject per UTC day. NULL = uncapped, which is only '
  'safe when the ad network''s own frequency capping is trusted to be the limit.';

-- ── enforce the ad cap in the same place the activity cap is enforced ───────────────────────────
-- Clamped, not rejected: a user at their ceiling has already watched the ad, and erroring would
-- take their attention and give nothing while telling them something broke.
CREATE OR REPLACE FUNCTION public.entitlement_ad_earned_today(
    p_tenant_id  UUID,
    p_subject_id UUID,
    p_sku        TEXT
)
RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(delta), 0)::INT
  FROM entitlement_balance_ledger
  WHERE tenant_id  = p_tenant_id
    AND subject_id = p_subject_id
    AND sku        = p_sku
    AND reason     = 'ad_reward'
    AND occurred_at >= date_trunc('day', now() AT TIME ZONE 'utc');
$$;

CREATE OR REPLACE FUNCTION public.entitlement_balance_ad_reward(
    p_tenant_id       UUID,
    p_subject_id      UUID,
    p_sku             TEXT,
    p_quantity        INT,
    p_idempotency_key TEXT
)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cap    INT;
  v_earned INT;
  v_grant  INT;
BEGIN
  IF p_quantity IS NULL OR p_quantity < 1 THEN
    RAISE EXCEPTION 'quantity must be >= 1' USING ERRCODE = 'check_violation';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key is required' USING ERRCODE = 'null_value_not_allowed';
  END IF;

  SELECT daily_ad_reward_cap INTO v_cap
  FROM tenant_products
  WHERE tenant_id = p_tenant_id AND sku = p_sku AND active;

  IF v_cap IS NULL THEN
    v_grant := p_quantity;                       -- uncapped: the network's frequency cap is the limit
  ELSE
    v_earned := entitlement_ad_earned_today(p_tenant_id, p_subject_id, p_sku);
    v_grant  := LEAST(p_quantity, GREATEST(v_cap - v_earned, 0));
  END IF;

  IF v_grant > 0 THEN
    INSERT INTO entitlement_balance_ledger
      (tenant_id, subject_id, sku, delta, reason, stable_txn_id, idempotency_key)
    VALUES
      (p_tenant_id, p_subject_id, p_sku, v_grant, 'ad_reward', NULL, btrim(p_idempotency_key))
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;
  END IF;

  RETURN public.entitlement_balance_of_tenant(p_tenant_id, p_subject_id, p_sku);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.entitlement_balance_ad_reward(UUID, UUID, TEXT, INT, TEXT) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.entitlement_balance_ad_reward(UUID, UUID, TEXT, INT, TEXT) TO service_role;
REVOKE EXECUTE ON FUNCTION public.entitlement_ad_earned_today(UUID, UUID, TEXT) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.entitlement_ad_earned_today(UUID, UUID, TEXT) TO service_role;
