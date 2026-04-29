-- Migration 020: Analytics Views
-- Materialized views for dashboard analytics. Refresh on demand or via cron.

-- MRR by tenant (Monthly Recurring Revenue)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_tenant_mrr AS
SELECT
    s.tenant_id,
    COALESCE(SUM(
        CASE p.interval
            WHEN 'month' THEN p.amount_cents
            WHEN 'year'  THEN p.amount_cents / 12
            WHEN 'week'  THEN p.amount_cents * 4
            WHEN 'day'   THEN p.amount_cents * 30
            ELSE 0
        END
    ), 0) AS mrr_cents,
    COUNT(*) AS active_subscribers,
    p.currency
FROM subscriptions s
LEFT JOIN tenant_plan_prices p
    ON s.tenant_id = p.tenant_id AND s.plan = p.plan_id
WHERE s.status IN ('active', 'trialing')
  AND s.mode = 'live'
  AND s.current_period_end > now()
GROUP BY s.tenant_id, p.currency;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_tenant_mrr
    ON mv_tenant_mrr(tenant_id, currency);

-- Subscriber count by month (for cohort/growth charts)
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_subscriber_cohorts AS
SELECT
    s.tenant_id,
    date_trunc('month', s.created_at) AS cohort_month,
    s.plan,
    s.status,
    COUNT(*) AS subscriber_count
FROM subscriptions s
WHERE s.mode = 'live'
GROUP BY s.tenant_id, cohort_month, s.plan, s.status;

CREATE INDEX IF NOT EXISTS idx_mv_subscriber_cohorts_tenant
    ON mv_subscriber_cohorts(tenant_id, cohort_month);

-- Churn events by month
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_churn_by_month AS
SELECT
    s.tenant_id,
    date_trunc('month', s.updated_at) AS churn_month,
    COUNT(*) AS churned_count
FROM subscriptions s
WHERE s.status = 'canceled'
  AND s.mode = 'live'
GROUP BY s.tenant_id, churn_month;

CREATE INDEX IF NOT EXISTS idx_mv_churn_tenant
    ON mv_churn_by_month(tenant_id, churn_month);

-- Refresh function (call from dashboard or cron)
CREATE OR REPLACE FUNCTION refresh_analytics()
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_tenant_mrr;
    REFRESH MATERIALIZED VIEW mv_subscriber_cohorts;
    REFRESH MATERIALIZED VIEW mv_churn_by_month;
END;
$$;
