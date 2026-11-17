-- 196 — a monthly grant PER PLAN on the 195 allowance (first consumer: ReelExport Plus 100 / Pro 300 / Max 1,500 / 6,000).
--
-- 195 gave every Pro member the same `pro_per_month`. A plan ladder needs the grant to follow the plan the member
-- pays for, so the allowance gains a map from subscription plan (the SKU the webhooks store in subscriptions.plan)
-- to units a month:
--   entitlement_monthly_allowance.plan_grants   NULL / {} = 195 behaviour; {"plus-monthly": 100, …} = that plan's grant
-- A Pro caller's grant is the largest grant among their live subscriptions' plans that the map lists, else
-- `pro_per_month`. Store entitlements (no plan) and unlisted plans keep `pro_per_month`. Everything else — spend
-- order, packs, all-or-nothing, refunds, the calendar-month reset — is 195 unchanged.
--
--   allowance_set_plan_grants(tenant, sku, jsonb)   set or clear the map (service role; PUT /v1/allowance)
--   _allowance_plan_grant(tenant, subject, token, map)
--   allowance_spend_units / allowance_status        redefined with the per-plan grant

ALTER TABLE public.entitlement_monthly_allowance ADD COLUMN IF NOT EXISTS plan_grants JSONB;

-- ── the caller's plan grant ─────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._allowance_plan_grant(p_tenant UUID, p_subject UUID, p_server_token TEXT, p_grants JSONB)
RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT max((p_grants->>s.plan)::INT)
    FROM subscriptions s
    JOIN registered_devices d ON d.device_token = p_server_token AND d.is_active AND d.tenant_id IS NOT DISTINCT FROM p_tenant
   WHERE p_grants IS NOT NULL
     AND (s.subject_id = p_subject OR s.email = lower(d.email))
     AND s.tenant_id IS NOT DISTINCT FROM p_tenant
     AND s.mode = d.mode
     AND s.status IN ('active', 'trialing')
     AND s.current_period_end > now()
     AND p_grants ? s.plan
$$;

-- ── configure the map ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.allowance_set_plan_grants(p_tenant_id UUID, p_sku TEXT, p_plan_grants JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  k TEXT; v JSONB;
BEGIN
  IF p_plan_grants IS NOT NULL THEN
    IF jsonb_typeof(p_plan_grants) <> 'object' THEN
      RAISE EXCEPTION 'plan_grants must be an object of plan → units' USING ERRCODE = 'check_violation';
    END IF;
    FOR k, v IN SELECT * FROM jsonb_each(p_plan_grants) LOOP
      IF jsonb_typeof(v) <> 'number' OR (v #>> '{}')::NUMERIC < 0 OR (v #>> '{}')::NUMERIC <> trunc((v #>> '{}')::NUMERIC) THEN
        RAISE EXCEPTION 'plan grant for % must be a whole number >= 0', k USING ERRCODE = 'check_violation';
      END IF;
    END LOOP;
  END IF;
  UPDATE entitlement_monthly_allowance SET plan_grants = NULLIF(p_plan_grants, '{}'::jsonb), updated_at = now()
   WHERE tenant_id = p_tenant_id AND sku = p_sku;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'no allowance % for this tenant — configure it first', p_sku USING ERRCODE = 'no_data_found';
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.allowance_set_plan_grants(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;

-- ── spend units (195 + per-plan grant) ──────────────────────────────────────────────────────────
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

  v_grant := CASE WHEN c.is_pro THEN coalesce(_allowance_plan_grant(c.tenant_id, c.subject_id, p_server_token, cfg.plan_grants), cfg.pro_per_month) ELSE cfg.free_per_month END;

  IF c.is_pro AND v_grant IS NULL THEN
    INSERT INTO entitlement_allowance_spends (tenant_id, idempotency_key, subject_id, sku, period, source, quantity, tier)
    VALUES (c.tenant_id, v_key, c.subject_id, p_sku, v_period, 'pro', p_quantity, 'pro');
    RETURN jsonb_build_object('source', 'pro', 'quantity', p_quantity, 'period_units', 0, 'credit_units', 0);
  END IF;

  -- Serialise this user's spends of this sku so two parallel calls cannot both take the last units.
  PERFORM pg_advisory_xact_lock(hashtext('allowance:' || c.tenant_id || ':' || c.subject_id || ':' || p_sku));

  v_tier := CASE WHEN c.is_pro THEN 'pro' ELSE 'free' END;
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

-- ── status (195 + per-plan grant) ───────────────────────────────────────────────────────────────
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
    v_grant := CASE WHEN c.is_pro THEN coalesce(_allowance_plan_grant(c.tenant_id, c.subject_id, p_server_token, cfg.plan_grants), cfg.pro_per_month) ELSE cfg.free_per_month END;
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

GRANT  EXECUTE ON FUNCTION public.allowance_set_plan_grants(UUID, TEXT, JSONB) TO service_role;
REVOKE EXECUTE ON FUNCTION public._allowance_plan_grant(UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
