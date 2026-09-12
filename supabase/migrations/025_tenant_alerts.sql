-- Migration 025: Tenant Alert Preferences
-- Stores per-tenant email notification preferences + alert log.

-- Alert preferences per tenant
CREATE TABLE IF NOT EXISTS public.tenant_alert_prefs (
    tenant_id    UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
    welcome      BOOLEAN NOT NULL DEFAULT TRUE,
    limit_warn   BOOLEAN NOT NULL DEFAULT TRUE,   -- approaching subscriber limit
    limit_hit    BOOLEAN NOT NULL DEFAULT TRUE,    -- at subscriber limit
    webhook_fail BOOLEAN NOT NULL DEFAULT TRUE,    -- consecutive webhook failures
    sub_expiry   BOOLEAN NOT NULL DEFAULT TRUE,    -- subscription expiring soon
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_alert_prefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_alert_prefs_service_role" ON public.tenant_alert_prefs
    FOR ALL USING (auth.role() = 'service_role');

-- Alert delivery log (dedup + audit)
CREATE TABLE IF NOT EXISTS public.tenant_alert_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    alert_type  TEXT NOT NULL,  -- welcome, limit_warn, limit_hit, webhook_fail, sub_expiry
    recipient   TEXT NOT NULL,  -- email address
    sent_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    resend_id   TEXT           -- Resend message ID for tracking
);

ALTER TABLE public.tenant_alert_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_alert_log_service_role" ON public.tenant_alert_log
    FOR ALL USING (auth.role() = 'service_role');

-- Index for dedup queries (don't send same alert twice in 24h)
CREATE INDEX IF NOT EXISTS idx_alert_log_dedup
    ON public.tenant_alert_log(tenant_id, alert_type, sent_at DESC);

-- Auto-create alert prefs when tenant is provisioned
CREATE OR REPLACE FUNCTION auto_create_alert_prefs()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    INSERT INTO tenant_alert_prefs (tenant_id)
    VALUES (NEW.id)
    ON CONFLICT (tenant_id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_alert_prefs ON public.tenants;
CREATE TRIGGER trg_auto_alert_prefs
    AFTER INSERT ON public.tenants
    FOR EACH ROW EXECUTE FUNCTION auto_create_alert_prefs();
