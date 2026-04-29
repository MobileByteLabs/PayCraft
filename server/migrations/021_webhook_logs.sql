-- Migration 021: Webhook Logs
-- Logs all incoming webhook events for monitoring and debugging.

CREATE TABLE IF NOT EXISTS public.webhook_logs (
    id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID        REFERENCES public.tenants(id),
    provider         TEXT        NOT NULL,
    event_type       TEXT        NOT NULL,
    status           TEXT        NOT NULL DEFAULT 'success'
                     CHECK (status IN ('success', 'failed')),
    payload_redacted JSONB       NOT NULL DEFAULT '{}'::jsonb,
    error_message    TEXT,
    processing_ms    INT,
    mode             TEXT        NOT NULL DEFAULT 'live',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "webhook_logs_service_role"
    ON public.webhook_logs FOR ALL
    USING (current_setting('role') = 'service_role')
    WITH CHECK (current_setting('role') = 'service_role');

-- Index for dashboard queries
CREATE INDEX IF NOT EXISTS idx_webhook_logs_tenant
    ON public.webhook_logs(tenant_id, created_at DESC);

-- Auto-purge logs older than 90 days (Supabase pg_cron — free)
-- Run: SELECT cron.schedule('purge-webhook-logs', '0 3 * * *', $$DELETE FROM webhook_logs WHERE created_at < now() - interval '90 days'$$);

COMMENT ON TABLE public.webhook_logs IS 'PayCraft: webhook event log for monitoring dashboard';
