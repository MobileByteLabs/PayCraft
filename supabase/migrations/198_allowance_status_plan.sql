-- 198 — allowance_status says which plan the caller is on, and any scheduled change (migration 197), so an app can
-- offer "Change plan" and show "Changes to Max 5× on 1 Dec" without a second call. Additive keys only:
--   plan             the caller's effective plan (subscription_effective_plan), NULL without a live subscription
--   pending_plan     a scheduled change not yet in effect (Razorpay cycle-end switch), else NULL
--   plan_changes_at  when it takes effect, else NULL

-- ── status (196 + the caller's plan and any scheduled change) ───────────────────────────────────────────────────────────────
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
  sub      RECORD;
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
  SELECT * INTO sub FROM subscription_change_caller(p_server_token, p_api_key);
  RETURN jsonb_build_object(
    'sku', p_sku,
    'plan', sub.plan,                                                                     -- effective plan, NULL = no live subscription
    'pending_plan', CASE WHEN sub.plan_changes_at > now() THEN sub.pending_plan END,      -- a scheduled change not yet in effect
    'plan_changes_at', CASE WHEN sub.plan_changes_at > now() THEN sub.plan_changes_at END,
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
