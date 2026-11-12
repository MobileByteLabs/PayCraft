-- 180: paywall_events — PayCraft's first-party paywall funnel (paycraft-paywall-analytics, GOAL D1).
--
-- Every step a buyer takes through the paywall, as emitted by the SDKs (event catalog:
-- cmp-paycraft-core/.../analytics/PayCraftEvent.kt) and stored by the `events` edge function. This table is
-- what the dashboard's funnel, country × provider split and abandon points read; the same events also reach
-- the app's own GA4 through the SDK listener, but GA4 lags and hides low counts, so the exact numbers live here.
--
-- Privacy (GOAL D10): no email or name — `user_ref` is a hash the function derives from the device token's
-- account, `device_ref` the SDK's per-app device fingerprint. `country` is stamped by the function from the
-- request, never trusted from the client. Rows are kept for the tenant tier's analytics_retention_days.

CREATE TABLE IF NOT EXISTS public.paywall_events (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_ref    TEXT,
  device_ref  TEXT,
  name        TEXT NOT NULL CHECK (name ~ '^paycraft_[a-z][a-z_]{0,30}$'),
  step        TEXT NOT NULL CHECK (step ~ '^[a-z][a-z_]{0,30}$'),
  platform    TEXT NOT NULL CHECK (platform IN ('android', 'ios', 'web', 'desktop')),
  trigger     TEXT CHECK (trigger IS NULL OR length(trigger) <= 100),
  sku         TEXT CHECK (sku IS NULL OR length(sku) <= 100),
  currency    TEXT CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  provider    TEXT CHECK (provider IS NULL OR length(provider) <= 40),
  reason      TEXT CHECK (reason IS NULL OR length(reason) <= 100),
  country     TEXT CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  mode        TEXT NOT NULL DEFAULT 'live' CHECK (mode IN ('live', 'test')),
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS paywall_events_tenant_time ON public.paywall_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS paywall_events_tenant_name_time ON public.paywall_events (tenant_id, name, occurred_at DESC);

ALTER TABLE public.paywall_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS paywall_events_service_role ON public.paywall_events;
CREATE POLICY paywall_events_service_role ON public.paywall_events FOR ALL
  USING (current_setting('role') = 'service_role')
  WITH CHECK (current_setting('role') = 'service_role');

DROP POLICY IF EXISTS paywall_events_tenant_admin_select ON public.paywall_events;
CREATE POLICY paywall_events_tenant_admin_select ON public.paywall_events FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT ta.tenant_id FROM public.tenant_admins ta WHERE ta.user_id = auth.uid()));

-- Retention: delete events older than the tenant tier's analytics_retention_days (90 when the tier is unknown).
-- Returns the number of rows removed. Run on a schedule (pg_cron) or from the dashboard's maintenance job.
CREATE OR REPLACE FUNCTION public.paywall_events_purge() RETURNS INT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH removed AS (
    DELETE FROM public.paywall_events e
    USING public.tenants t
    LEFT JOIN public.tier_definitions td ON td.tier_name = t.plan
    WHERE e.tenant_id = t.id
      AND e.occurred_at < now() - make_interval(days => COALESCE(td.analytics_retention_days, 90))
    RETURNING 1
  )
  SELECT count(*)::INT FROM removed
$$;

REVOKE ALL ON FUNCTION public.paywall_events_purge() FROM PUBLIC, anon, authenticated;
