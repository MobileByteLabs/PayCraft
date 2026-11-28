-- 223 — paywall_events release dimensions + live analytics (realtime-analytics design, "Database").
--
-- When a release ships the owner must see its effect within minutes, per app version. This adds
--   * paywall_events.app_version (≤ 40, existed since 215 without a cap), app_build (≥ 0), os_version (≤ 20) —
--     stamped by the `events` function, which drops an invalid value rather than refusing the event
--   * index (tenant_id, app_version, occurred_at DESC) for the per-version reads below
--   * paywall_live_minutes   — per-minute event + device counts by name and version (the Live page sparkline)
--   * paywall_version_compare — the release table: funnel + identity flows per app_version
--   * paywall_events in the supabase_realtime publication (the Live page's event stream). RLS already lets a tenant
--     admin SELECT only their tenant's rows (180, paywall_events_tenant_admin_select) and anon has no policy, so
--     Realtime delivers a member their own tenant's INSERTs and nothing else — no policy change here.
--
-- Both RPCs: a null app_version is grouped as 'unknown' (never dropped); every count is distinct devices
-- (device_ref), except paywall_live_minutes.events (rows). Callable by service_role, or by an authenticated
-- admin of p_tenant (the 215 paywall_funnel_stats check) — anyone else gets 42501 'forbidden'.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, constraints added only when missing, CREATE OR REPLACE, guarded publication.

ALTER TABLE public.paywall_events ADD COLUMN IF NOT EXISTS app_version TEXT;
ALTER TABLE public.paywall_events ADD COLUMN IF NOT EXISTS app_build   INT;
ALTER TABLE public.paywall_events ADD COLUMN IF NOT EXISTS os_version  TEXT;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paywall_events_app_version_check') THEN
    ALTER TABLE public.paywall_events
      ADD CONSTRAINT paywall_events_app_version_check CHECK (app_version IS NULL OR length(app_version) <= 40);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paywall_events_app_build_check') THEN
    ALTER TABLE public.paywall_events
      ADD CONSTRAINT paywall_events_app_build_check CHECK (app_build IS NULL OR app_build >= 0);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paywall_events_os_version_check') THEN
    ALTER TABLE public.paywall_events
      ADD CONSTRAINT paywall_events_os_version_check CHECK (os_version IS NULL OR length(os_version) <= 20);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS paywall_events_tenant_version_time
  ON public.paywall_events (tenant_id, app_version, occurred_at DESC);

-- Per-minute counts since p_since: one row per (minute, event name, app version).
CREATE OR REPLACE FUNCTION public.paywall_live_minutes(p_tenant UUID, p_since TIMESTAMPTZ, p_mode TEXT)
RETURNS TABLE (minute TIMESTAMPTZ, name TEXT, app_version TEXT, events INT, devices INT)
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
  SELECT date_trunc('minute', e.occurred_at)          AS minute,
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

-- The release table: per app_version since p_since, newest version (first seen) first. purchase_rate =
-- purchases / paywall_views (devices), null when no device viewed the paywall.
CREATE OR REPLACE FUNCTION public.paywall_version_compare(p_tenant UUID, p_since TIMESTAMPTZ, p_mode TEXT)
RETURNS TABLE (
  app_version        TEXT,
  devices            INT,
  paywall_views      INT,
  purchases          INT,
  purchase_rate      NUMERIC,
  sign_in_views      INT,
  sign_in_completes  INT,
  sign_in_fails      INT,
  restores_found     INT,
  restores_not_found INT,
  device_limit_views INT,
  device_transfers   INT,
  first_seen         TIMESTAMPTZ,
  last_seen          TIMESTAMPTZ
)
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
  WITH v AS (
    SELECT COALESCE(e.app_version, 'unknown') AS ver,
           count(DISTINCT e.device_ref)                                                        AS devices,
           count(DISTINCT e.device_ref) FILTER (WHERE e.name = 'paycraft_paywall_view')        AS paywall_views,
           count(DISTINCT e.device_ref) FILTER (WHERE e.name = 'paycraft_purchase_success')    AS purchases,
           count(DISTINCT e.device_ref) FILTER (WHERE e.name = 'paycraft_sign_in_view')        AS sign_in_views,
           count(DISTINCT e.device_ref) FILTER (WHERE e.name = 'paycraft_sign_in_complete')    AS sign_in_completes,
           count(DISTINCT e.device_ref) FILTER (WHERE e.name = 'paycraft_sign_in_fail')        AS sign_in_fails,
           count(DISTINCT e.device_ref) FILTER (WHERE e.name = 'paycraft_restore_result' AND e.reason = 'found')
                                                                                               AS restores_found,
           count(DISTINCT e.device_ref) FILTER (WHERE e.name = 'paycraft_restore_result' AND e.reason = 'not_found')
                                                                                               AS restores_not_found,
           count(DISTINCT e.device_ref) FILTER (WHERE e.name = 'paycraft_device_limit_view')   AS device_limit_views,
           count(DISTINCT e.device_ref) FILTER (WHERE e.name = 'paycraft_device_transfer' AND e.reason = 'done')
                                                                                               AS device_transfers,
           min(e.occurred_at) AS first_seen,
           max(e.occurred_at) AS last_seen
      FROM paywall_events e
     WHERE e.tenant_id = p_tenant AND e.mode = p_mode AND e.occurred_at >= p_since
     GROUP BY 1
  )
  SELECT v.ver, v.devices::INT, v.paywall_views::INT, v.purchases::INT,
         round(v.purchases::NUMERIC / NULLIF(v.paywall_views, 0), 4),
         v.sign_in_views::INT, v.sign_in_completes::INT, v.sign_in_fails::INT,
         v.restores_found::INT, v.restores_not_found::INT, v.device_limit_views::INT, v.device_transfers::INT,
         v.first_seen, v.last_seen
    FROM v
   ORDER BY v.first_seen DESC, v.ver;
END;
$$;

REVOKE ALL ON FUNCTION public.paywall_live_minutes(UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.paywall_version_compare(UUID, TIMESTAMPTZ, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.paywall_live_minutes(UUID, TIMESTAMPTZ, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.paywall_version_compare(UUID, TIMESTAMPTZ, TEXT) TO authenticated, service_role;

-- The Live page's event stream (Supabase Realtime INSERTs, filtered by tenant_id; RLS scopes delivery).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime')
     AND NOT EXISTS (SELECT 1 FROM pg_publication_tables
                      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'paywall_events') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.paywall_events;
  END IF;
END $$;
