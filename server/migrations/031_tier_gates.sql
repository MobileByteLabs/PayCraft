-- 031_tier_gates.sql — Config-table-based tier definitions + enforce_tier_gate()
-- Per D25: numeric thresholds + entitlements live in tier_definitions config table,
-- NOT hard-coded constants — tunable post-launch via dashboard / SQL.
BEGIN;

CREATE TABLE IF NOT EXISTS tier_definitions (
  tier_name                    TEXT PRIMARY KEY,         -- 'free' | 'pro' | 'enterprise'
  display_name                 TEXT NOT NULL,
  max_active_subscribers       INT,                      -- NULL = unlimited
  max_webhook_events_per_month INT,
  max_connected_providers      INT,
  max_products                 INT,
  max_dashboard_users          INT,
  analytics_retention_days     INT NOT NULL,
  attribution_required         BOOLEAN NOT NULL DEFAULT true,
  entitlements                 JSONB NOT NULL DEFAULT '[]'::jsonb,  -- array of gate-name strings
  base_price_cents             INT NOT NULL DEFAULT 0,
  base_currency                TEXT NOT NULL DEFAULT 'USD',
  metered_per_subscriber_cents INT DEFAULT 0,
  updated_at                   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed Free / Pro / Enterprise tiers per D25 default config.
INSERT INTO tier_definitions (
  tier_name, display_name, max_active_subscribers, max_webhook_events_per_month,
  max_connected_providers, max_products, max_dashboard_users,
  analytics_retention_days, attribution_required, entitlements,
  base_price_cents, base_currency, metered_per_subscriber_cents
) VALUES
  ('free', 'Free',
    100, 10000, 1, 1, 3,
    7, true, '[]'::jsonb,
    0, 'USD', 0),
  ('pro', 'Pro',
    1000, NULL, NULL, NULL, NULL,
    90, false,
    '["multi_provider","unlimited_subscribers","remove_attribution","analytics_90day","team_size_unlimited"]'::jsonb,
    2900, 'USD', 10),
  ('enterprise', 'Enterprise',
    NULL, NULL, NULL, NULL, NULL,
    365, false,
    '["multi_provider","unlimited_subscribers","remove_attribution","analytics_90day","team_size_unlimited","custom_branding","self_host_license"]'::jsonb,
    0, 'USD', 0)
ON CONFLICT (tier_name) DO NOTHING;

-- Denormalized entitlements cache on tenants (refreshed on plan change for fast lookups)
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS entitlements JSONB NOT NULL DEFAULT '[]'::jsonb;

-- The single gate function — called at every edge function + RPC entry.
CREATE OR REPLACE FUNCTION enforce_tier_gate(p_tenant_id UUID, p_gate_name TEXT)
RETURNS BOOLEAN
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN t.plan IS NULL THEN false
    WHEN td.entitlements ? p_gate_name THEN true
    ELSE false
  END
  FROM tenants t
  LEFT JOIN tier_definitions td ON td.tier_name = t.plan
  WHERE t.id = p_tenant_id
  LIMIT 1;
$$;

-- Refresh denormalized cache after upgrade/downgrade.
CREATE OR REPLACE FUNCTION refresh_tenant_entitlements(p_tenant_id UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE tenants t
     SET entitlements = COALESCE(
       (SELECT td.entitlements FROM tier_definitions td WHERE td.tier_name = t.plan),
       '[]'::jsonb
     )
   WHERE t.id = p_tenant_id;
$$;

-- Backfill: refresh all existing tenants once.
UPDATE tenants t
   SET entitlements = COALESCE(
     (SELECT td.entitlements FROM tier_definitions td WHERE td.tier_name = t.plan),
     '[]'::jsonb
   )
 WHERE entitlements = '[]'::jsonb AND t.plan IS NOT NULL;

COMMIT;
