-- 028_tenant_products.sql — Per-tenant product declarations (Subscription / Trial / Lifetime)
BEGIN;

-- Product type taxonomy. Maps 1:1 to the SDK's sealed Product hierarchy.
DO $$ BEGIN
  CREATE TYPE product_type AS ENUM ('subscription', 'trial', 'lifetime');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS tenant_products (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id              UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sku                    TEXT NOT NULL,
  type                   product_type NOT NULL,
  display_name           TEXT NOT NULL,
  -- trial-specific
  trial_duration_days    INT CHECK (trial_duration_days IS NULL OR trial_duration_days BETWEEN 1 AND 365),
  attaches_to_product_id UUID REFERENCES tenant_products(id) ON DELETE SET NULL,
  -- subscription-specific
  interval               TEXT CHECK (interval IS NULL OR interval IN ('month','quarter','semiannual','year')),
  -- common
  base_price_cents       INT NOT NULL DEFAULT 0,
  base_currency          TEXT NOT NULL DEFAULT 'USD',
  display_order          INT NOT NULL DEFAULT 0,
  active                 BOOLEAN NOT NULL DEFAULT true,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, sku)
);

CREATE INDEX IF NOT EXISTS tenant_products_tenant_idx
  ON tenant_products(tenant_id, active, display_order);

ALTER TABLE tenant_products ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_products_read ON tenant_products;
CREATE POLICY tenant_products_read ON tenant_products FOR SELECT
  USING (tenant_id IN (SELECT ta.tenant_id FROM tenant_admins ta WHERE ta.user_id = auth.uid()));

-- SECURITY DEFINER RPCs (callable by service_role / edge functions only)
CREATE OR REPLACE FUNCTION tenant_products_list(p_tenant_id UUID)
RETURNS SETOF tenant_products
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT * FROM tenant_products
   WHERE tenant_id = p_tenant_id AND active = true
   ORDER BY display_order, created_at;
$$;

CREATE OR REPLACE FUNCTION tenant_products_upsert(p_row JSONB)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO tenant_products (
    id, tenant_id, sku, type, display_name,
    trial_duration_days, attaches_to_product_id, interval,
    base_price_cents, base_currency, display_order, active
  )
  VALUES (
    COALESCE(NULLIF(p_row->>'id','')::UUID, gen_random_uuid()),
    (p_row->>'tenant_id')::UUID,
    p_row->>'sku',
    (p_row->>'type')::product_type,
    p_row->>'display_name',
    NULLIF(p_row->>'trial_duration_days','')::INT,
    NULLIF(p_row->>'attaches_to_product_id','')::UUID,
    NULLIF(p_row->>'interval',''),
    COALESCE((p_row->>'base_price_cents')::INT, 0),
    COALESCE(p_row->>'base_currency', 'USD'),
    COALESCE((p_row->>'display_order')::INT, 0),
    COALESCE((p_row->>'active')::BOOLEAN, true)
  )
  ON CONFLICT (id) DO UPDATE
    SET sku                    = EXCLUDED.sku,
        type                   = EXCLUDED.type,
        display_name           = EXCLUDED.display_name,
        trial_duration_days    = EXCLUDED.trial_duration_days,
        attaches_to_product_id = EXCLUDED.attaches_to_product_id,
        interval               = EXCLUDED.interval,
        base_price_cents       = EXCLUDED.base_price_cents,
        base_currency          = EXCLUDED.base_currency,
        display_order          = EXCLUDED.display_order,
        active                 = EXCLUDED.active,
        updated_at             = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION tenant_products_delete(p_id UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE tenant_products SET active = false, updated_at = now() WHERE id = p_id;
$$;

COMMIT;
