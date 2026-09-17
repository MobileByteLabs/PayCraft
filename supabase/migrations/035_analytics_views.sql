-- 035_analytics_views.sql — MRR / churn / subscriber count / revenue / webhook delivery views
-- Joins against tenant_products (migration 028) for plan-aware aggregations.
-- The earlier 020_analytics_views.sql remains in place.
BEGIN;

-- MRR: monthly-equivalent revenue across active subscriptions, per tenant.
CREATE OR REPLACE VIEW tenant_mrr_view AS
  SELECT s.tenant_id,
         date_trunc('month', now())::DATE AS month,
         COALESCE(SUM(
           CASE p.interval
             WHEN 'month'      THEN p.base_price_cents
             WHEN 'quarter'    THEN p.base_price_cents / 3
             WHEN 'semiannual' THEN p.base_price_cents / 6
             WHEN 'year'       THEN p.base_price_cents / 12
             ELSE 0
           END
         ), 0) / 100.0 AS mrr_dollars
    FROM subscriptions s
    LEFT JOIN tenant_products p ON p.sku = s.plan AND p.tenant_id = s.tenant_id
   WHERE s.status IN ('active','trialing')
   GROUP BY s.tenant_id;

-- Active subscriber count per tenant.
CREATE OR REPLACE VIEW tenant_subscriber_count_view AS
  SELECT tenant_id,
         COUNT(*) FILTER (WHERE status IN ('active','trialing')) AS active_count,
         COUNT(*) FILTER (WHERE status = 'trialing')             AS trial_count,
         COUNT(*) FILTER (WHERE status = 'canceled')             AS canceled_count
    FROM subscriptions
   GROUP BY tenant_id;

-- Monthly churn rate (last 12 months).
CREATE OR REPLACE VIEW tenant_churn_view AS
  SELECT tenant_id,
         date_trunc('month', updated_at)::DATE AS month,
         COUNT(*) FILTER (WHERE status = 'canceled') AS churn_count,
         COUNT(*) AS total_count,
         CASE WHEN COUNT(*) = 0 THEN 0::FLOAT
              ELSE COUNT(*) FILTER (WHERE status = 'canceled')::FLOAT / COUNT(*)
         END AS churn_rate
    FROM subscriptions
   WHERE updated_at > now() - INTERVAL '12 months'
   GROUP BY tenant_id, date_trunc('month', updated_at);

-- Revenue grouped by plan SKU.
CREATE OR REPLACE VIEW tenant_revenue_by_plan_view AS
  SELECT s.tenant_id,
         s.plan,
         COUNT(*) AS subscribers,
         COALESCE(SUM(p.base_price_cents), 0) / 100.0 AS total_revenue_dollars
    FROM subscriptions s
    LEFT JOIN tenant_products p ON p.sku = s.plan AND p.tenant_id = s.tenant_id
   WHERE s.status IN ('active','trialing')
   GROUP BY s.tenant_id, s.plan;

-- Webhook delivery success rate (last 30 days).
CREATE OR REPLACE VIEW tenant_webhook_delivery_view AS
  SELECT tenant_id,
         COUNT(*) AS total,
         COUNT(*) FILTER (WHERE status = 'success') AS success,
         CASE WHEN COUNT(*) = 0 THEN 1::FLOAT
              ELSE COUNT(*) FILTER (WHERE status = 'success')::FLOAT / COUNT(*)
         END AS success_rate
    FROM webhook_logs
   WHERE created_at > now() - INTERVAL '30 days'
   GROUP BY tenant_id;

COMMIT;
