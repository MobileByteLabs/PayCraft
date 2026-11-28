-- 225 — Live page ranges + where buyers leave.
--
-- The Live page (223) was fixed to one hour; it now offers 1 h / 24 h / 7 d / 30 d. Per-minute rows over 30 days
-- are far too many, so the series is bucketed by the caller's choice of minute / hour / day:
--   * paywall_live_series — event + device counts per (bucket, event name, app version)
--   * paywall_exit_steps  — where buyers leave: every step_abandon / purchase_fail / offer_decline / attempt_abandon
--     grouped by step + reason, with the plan (sku) they were on, so "closed the paywall while choosing Quarterly"
--     is countable over any range.
--
-- Both: a null app_version / reason / sku is reported as 'unknown' / '' (never dropped); devices = distinct
-- device_ref. Callable by service_role or an authenticated admin of p_tenant (the 223 check) — anyone else 42501.
-- Idempotent: CREATE OR REPLACE, grants re-applied.

CREATE OR REPLACE FUNCTION public.paywall_live_series(p_tenant UUID, p_since TIMESTAMPTZ, p_mode TEXT, p_bucket TEXT)
RETURNS TABLE (bucket TIMESTAMPTZ, name TEXT, app_version TEXT, events INT, devices INT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (SELECT 1 FROM tenant_admins ta WHERE ta.tenant_id = p_tenant AND ta.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_bucket NOT IN ('minute', 'hour', 'day') THEN
    RAISE EXCEPTION 'bad_bucket' USING ERRCODE = '22023';
  END IF;

  RETURN QUERY
  SELECT date_trunc(p_bucket, e.occurred_at)          AS bucket,
         e.name                                      AS name,
         COALESCE(e.app_version, 'unknown')          AS app_version,
         count(*)::INT                               AS events,
         count(DISTINCT e.device_ref)::INT           AS devices
    FROM paywall_events e
   WHERE e.tenant_id = p_tenant AND e.mode = p_mode AND e.occurred_at >= p_since
   GROUP BY 1, 2, 3
   ORDER BY 1, 2, 3;
END;
$$;

-- Where buyers leave since p_since: one row per (exit event, step, reason, sku), most devices first.
CREATE OR REPLACE FUNCTION public.paywall_exit_steps(p_tenant UUID, p_since TIMESTAMPTZ, p_mode TEXT)
RETURNS TABLE (name TEXT, step TEXT, reason TEXT, sku TEXT, exits INT, devices INT)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (SELECT 1 FROM tenant_admins ta WHERE ta.tenant_id = p_tenant AND ta.user_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT e.name                             AS name,
         e.step                             AS step,
         COALESCE(e.reason, '')             AS reason,
         COALESCE(e.sku, '')                AS sku,
         count(*)::INT                      AS exits,
         count(DISTINCT e.device_ref)::INT  AS devices
    FROM paywall_events e
   WHERE e.tenant_id = p_tenant AND e.mode = p_mode AND e.occurred_at >= p_since
     AND e.name IN ('paycraft_step_abandon', 'paycraft_purchase_fail', 'paycraft_offer_decline', 'paycraft_attempt_abandon')
   GROUP BY 1, 2, 3, 4
   ORDER BY 6 DESC, 5 DESC, 1, 2;
END;
$$;

REVOKE ALL ON FUNCTION public.paywall_live_series(UUID, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.paywall_exit_steps(UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.paywall_live_series(UUID, TIMESTAMPTZ, TEXT, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.paywall_exit_steps(UUID, TIMESTAMPTZ, TEXT) TO authenticated, service_role;
