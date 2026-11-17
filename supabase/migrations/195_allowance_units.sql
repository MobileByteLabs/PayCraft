-- 195 — metered UNITS and a Pro monthly grant on the 189 allowance (first consumer: ReelExport credits).
--
-- WHY
-- 189 meters one use per call and never meters Pro. A credits model needs both the other way round:
-- an AI image costs 15 credits and a clip 100, and Pro is not unlimited — it carries a monthly grant
-- (ReelExport: 300 credits) that is spent first, then the user's never-expiring pack balance.
--
-- WHAT CHANGES (all additive; 189 callers keep their exact behaviour)
--   entitlement_monthly_allowance.pro_per_month   NULL = Pro unmetered (189 behaviour); N = Pro's monthly grant
--   entitlement_allowance_spends.{quantity, period_units, credit_units, tier}
--                                                  a spend can take part from the month's grant/free uses and
--                                                  part from ONE credit balance; tier says whose grant it used
--   allowance_spend_units(token, key, sku, qty, idem) → {source, quantity, period_units, credit_units}
--                                                  all-or-nothing: short → 'refused', nothing debited
--   allowance_spend (189)    now delegates with qty 1 and still returns TEXT
--   allowance_refund (189)   gives back every unit (grant part by refunded_at, pack part by a ledger row)
--   allowance_status (189)   adds grant_per_month / grant_used / grant_remaining for the caller's tier
--   allowance_configure      5-arg overload taking p_pro_per_month
--
-- The grant needs no webhook: it is "units spent this calendar month" counted from the spend log, so it
-- resets by itself on the 1st (UTC) and unused units do not roll over. Packs live in the 157 ledger and
-- never expire. Idempotent throughout.

ALTER TABLE public.entitlement_monthly_allowance ADD COLUMN IF NOT EXISTS pro_per_month INT CHECK (pro_per_month IS NULL OR pro_per_month >= 0);

ALTER TABLE public.entitlement_allowance_spends ADD COLUMN IF NOT EXISTS quantity     INT  NOT NULL DEFAULT 1;
ALTER TABLE public.entitlement_allowance_spends ADD COLUMN IF NOT EXISTS period_units INT  NOT NULL DEFAULT 0;
ALTER TABLE public.entitlement_allowance_spends ADD COLUMN IF NOT EXISTS credit_units INT  NOT NULL DEFAULT 0;
ALTER TABLE public.entitlement_allowance_spends ADD COLUMN IF NOT EXISTS tier         TEXT NOT NULL DEFAULT 'free';

-- Backfill 189 rows so one SUM serves both: an allowance use was 1 free unit, a credit use 1 pack unit.
UPDATE public.entitlement_allowance_spends SET period_units = 1 WHERE source = 'allowance' AND period_units = 0 AND credit_units = 0;
UPDATE public.entitlement_allowance_spends SET credit_units = 1 WHERE source = 'credit' AND credit_units = 0;
UPDATE public.entitlement_allowance_spends SET tier = 'pro' WHERE source = 'pro' AND tier <> 'pro';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'entitlement_allowance_spends_units_ok') THEN
    ALTER TABLE public.entitlement_allowance_spends ADD CONSTRAINT entitlement_allowance_spends_units_ok
      CHECK (quantity >= 1 AND period_units >= 0 AND credit_units >= 0 AND period_units + credit_units <= quantity AND tier IN ('free', 'pro'));
  END IF;
END $$;

-- ── spend units ──────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.allowance_spend_units(
    p_server_token    TEXT,
    p_api_key         TEXT,
    p_sku             TEXT,
    p_quantity        INT,
    p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c        RECORD;
  cfg      RECORD;
  prev     RECORD;
  v_key    TEXT := btrim(coalesce(p_idempotency_key, ''));
  v_period DATE := _allowance_period();
  v_tier   TEXT;
  v_grant  INT;
  v_used   INT;
  v_take   INT;
  v_need   INT;
  v_credit TEXT;
  v_paid   TEXT;
  v_source TEXT;
BEGIN
  IF v_key = '' THEN
    RAISE EXCEPTION 'idempotency_key is required' USING ERRCODE = 'null_value_not_allowed';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 1 THEN
    RAISE EXCEPTION 'quantity must be >= 1' USING ERRCODE = 'check_violation';
  END IF;
  SELECT * INTO c FROM _allowance_caller(p_server_token, p_api_key);

  SELECT * INTO prev FROM entitlement_allowance_spends WHERE tenant_id = c.tenant_id AND idempotency_key = v_key;
  IF FOUND THEN
    RETURN jsonb_build_object('source', prev.source, 'quantity', prev.quantity, 'period_units', prev.period_units, 'credit_units', prev.credit_units);
  END IF;

  SELECT * INTO cfg FROM entitlement_monthly_allowance WHERE tenant_id = c.tenant_id AND sku = p_sku;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('source', 'refused', 'quantity', p_quantity, 'period_units', 0, 'credit_units', 0);
  END IF;

  IF c.is_pro AND cfg.pro_per_month IS NULL THEN
    INSERT INTO entitlement_allowance_spends (tenant_id, idempotency_key, subject_id, sku, period, source, quantity, tier)
    VALUES (c.tenant_id, v_key, c.subject_id, p_sku, v_period, 'pro', p_quantity, 'pro');
    RETURN jsonb_build_object('source', 'pro', 'quantity', p_quantity, 'period_units', 0, 'credit_units', 0);
  END IF;

  -- Serialise this user's spends of this sku so two parallel calls cannot both take the last units.
  PERFORM pg_advisory_xact_lock(hashtext('allowance:' || c.tenant_id || ':' || c.subject_id || ':' || p_sku));

  v_tier  := CASE WHEN c.is_pro THEN 'pro' ELSE 'free' END;
  v_grant := CASE WHEN c.is_pro THEN cfg.pro_per_month ELSE cfg.free_per_month END;
  SELECT coalesce(sum(period_units), 0) INTO v_used FROM entitlement_allowance_spends
   WHERE tenant_id = c.tenant_id AND subject_id = c.subject_id AND sku = p_sku
     AND period = v_period AND tier = v_tier AND refunded_at IS NULL;
  v_take := LEAST(p_quantity, GREATEST(v_grant - v_used, 0));
  v_need := p_quantity - v_take;

  IF v_need > 0 THEN
    FOREACH v_credit IN ARRAY cfg.credit_skus LOOP
      IF entitlement_balance_of_tenant(c.tenant_id, c.subject_id, v_credit) >= v_need THEN
        v_paid := v_credit;
        EXIT;
      END IF;
    END LOOP;
    IF v_paid IS NULL THEN
      RETURN jsonb_build_object('source', 'refused', 'quantity', p_quantity, 'period_units', 0, 'credit_units', 0);
    END IF;
    PERFORM entitlement_balance_spend(p_api_key, c.subject_id, v_paid, v_need, 'allowance:' || v_key);
  END IF;

  v_source := CASE WHEN v_need > 0 THEN 'credit' WHEN c.is_pro THEN 'pro' ELSE 'allowance' END;
  INSERT INTO entitlement_allowance_spends (tenant_id, idempotency_key, subject_id, sku, period, source, credit_sku, quantity, period_units, credit_units, tier)
  VALUES (c.tenant_id, v_key, c.subject_id, p_sku, v_period, v_source, v_paid, p_quantity, v_take, v_need, v_tier);
  RETURN jsonb_build_object('source', v_source, 'quantity', p_quantity, 'period_units', v_take, 'credit_units', v_need);
END $$;

-- ── 189 spend, now one unit of the above ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.allowance_spend(
    p_server_token    TEXT,
    p_api_key         TEXT,
    p_sku             TEXT,
    p_idempotency_key TEXT
)
RETURNS TEXT
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$ SELECT allowance_spend_units(p_server_token, p_api_key, p_sku, 1, p_idempotency_key)->>'source' $$;

-- ── status ───────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.allowance_status(p_server_token TEXT, p_api_key TEXT, p_sku TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c        RECORD;
  cfg      RECORD;
  v_used   INT := 0;   -- free uses this month (189 meaning)
  v_gused  INT := 0;   -- units of the caller's tier grant this month
  v_grant  INT;
  v_cred   INT := 0;
  v_sku    TEXT;
  v_free   INT := 0;
BEGIN
  SELECT * INTO c FROM _allowance_caller(p_server_token, p_api_key);
  SELECT * INTO cfg FROM entitlement_monthly_allowance WHERE tenant_id = c.tenant_id AND sku = p_sku;
  IF FOUND THEN
    v_free := cfg.free_per_month;
    v_grant := CASE WHEN c.is_pro THEN cfg.pro_per_month ELSE cfg.free_per_month END;
    SELECT coalesce(sum(period_units), 0) INTO v_used FROM entitlement_allowance_spends
     WHERE tenant_id = c.tenant_id AND subject_id = c.subject_id AND sku = p_sku
       AND period = _allowance_period() AND tier = 'free' AND refunded_at IS NULL;
    SELECT coalesce(sum(period_units), 0) INTO v_gused FROM entitlement_allowance_spends
     WHERE tenant_id = c.tenant_id AND subject_id = c.subject_id AND sku = p_sku
       AND period = _allowance_period() AND tier = CASE WHEN c.is_pro THEN 'pro' ELSE 'free' END AND refunded_at IS NULL;
    FOREACH v_sku IN ARRAY cfg.credit_skus LOOP
      v_cred := v_cred + GREATEST(entitlement_balance_of_tenant(c.tenant_id, c.subject_id, v_sku), 0);
    END LOOP;
  END IF;
  RETURN jsonb_build_object(
    'sku', p_sku,
    'is_pro', c.is_pro,
    'free_per_month', v_free,
    'used', v_used,
    'remaining', GREATEST(v_free - v_used, 0),
    'grant_per_month', v_grant,             -- NULL = unmetered (Pro without a grant)
    'grant_used', v_gused,
    'grant_remaining', CASE WHEN v_grant IS NULL THEN NULL ELSE GREATEST(v_grant - v_gused, 0) END,
    'credits', v_cred,
    'resets_at', (_allowance_period() + interval '1 month')::timestamp AT TIME ZONE 'UTC'
  );
END $$;

-- ── refund: every unit back, once ────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.allowance_refund(p_tenant_id UUID, p_idempotency_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
BEGIN
  UPDATE entitlement_allowance_spends SET refunded_at = now()
   WHERE tenant_id = p_tenant_id AND idempotency_key = btrim(p_idempotency_key) AND refunded_at IS NULL
  RETURNING * INTO s;
  IF NOT FOUND THEN
    RETURN false;   -- unknown, or already refunded: refunding twice must not mint units
  END IF;
  IF s.credit_units > 0 THEN
    INSERT INTO entitlement_balance_ledger (tenant_id, subject_id, sku, delta, reason, idempotency_key)
    VALUES (s.tenant_id, s.subject_id, s.credit_sku, s.credit_units, 'adjustment', 'allowance-refund:' || s.idempotency_key)
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;
  END IF;
  RETURN true;
END $$;

-- ── configure with a Pro grant ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.allowance_configure(p_tenant_id UUID, p_sku TEXT, p_free_per_month INT, p_credit_skus TEXT[], p_pro_per_month INT)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO entitlement_monthly_allowance (tenant_id, sku, free_per_month, credit_skus, pro_per_month)
  VALUES (p_tenant_id, p_sku, p_free_per_month, coalesce(p_credit_skus, '{}'), p_pro_per_month)
  ON CONFLICT (tenant_id, sku) DO UPDATE
    SET free_per_month = EXCLUDED.free_per_month, credit_skus = EXCLUDED.credit_skus,
        pro_per_month = EXCLUDED.pro_per_month, updated_at = now();
$$;

GRANT  EXECUTE ON FUNCTION public.allowance_spend_units(TEXT, TEXT, TEXT, INT, TEXT) TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.allowance_configure(UUID, TEXT, INT, TEXT[], INT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.allowance_configure(UUID, TEXT, INT, TEXT[], INT) TO service_role;
