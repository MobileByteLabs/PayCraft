-- 029_tenant_pricing.sql — Per-locale pricing per product
BEGIN;

DO $$ BEGIN
  CREATE TYPE pricing_source AS ENUM ('manual','stripe','razorpay','fallback');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS tenant_pricing (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id  UUID NOT NULL REFERENCES tenant_products(id) ON DELETE CASCADE,
  locale      TEXT NOT NULL,                       -- ISO 3166-1 alpha-2 country code, uppercase
  amount_cents INT NOT NULL,
  currency    TEXT NOT NULL,                       -- ISO 4217
  source      pricing_source NOT NULL DEFAULT 'manual',
  source_ref  TEXT,                                -- e.g. stripe price_id
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, product_id, locale)
);

CREATE INDEX IF NOT EXISTS tenant_pricing_lookup
  ON tenant_pricing(tenant_id, product_id, locale);

ALTER TABLE tenant_pricing ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_pricing_read ON tenant_pricing;
CREATE POLICY tenant_pricing_read ON tenant_pricing FOR SELECT
  USING (tenant_id IN (SELECT ta.tenant_id FROM tenant_admins ta WHERE ta.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION tenant_pricing_resolve(
  p_tenant_id UUID, p_product_id UUID, p_locale TEXT
)
RETURNS TABLE(amount_cents INT, currency TEXT, source pricing_source)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT tp.amount_cents, tp.currency, tp.source
    FROM tenant_pricing tp
   WHERE tp.tenant_id = p_tenant_id
     AND tp.product_id = p_product_id
     AND tp.locale = UPPER(p_locale)
   LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION tenant_pricing_upsert(p_row JSONB)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  INSERT INTO tenant_pricing(id, tenant_id, product_id, locale, amount_cents, currency, source, source_ref)
  VALUES (
    COALESCE(NULLIF(p_row->>'id','')::UUID, gen_random_uuid()),
    (p_row->>'tenant_id')::UUID,
    (p_row->>'product_id')::UUID,
    UPPER(p_row->>'locale'),
    (p_row->>'amount_cents')::INT,
    p_row->>'currency',
    COALESCE((p_row->>'source')::pricing_source, 'manual'),
    p_row->>'source_ref'
  )
  ON CONFLICT (tenant_id, product_id, locale) DO UPDATE
    SET amount_cents = EXCLUDED.amount_cents,
        currency     = EXCLUDED.currency,
        source       = EXCLUDED.source,
        source_ref   = EXCLUDED.source_ref,
        updated_at   = now()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION tenant_pricing_bulk_upsert(p_tenant_id UUID, p_product_id UUID, p_rows JSONB)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n INT := 0;
  rec JSONB;
BEGIN
  FOR rec IN SELECT * FROM jsonb_array_elements(p_rows)
  LOOP
    PERFORM tenant_pricing_upsert(rec || jsonb_build_object('tenant_id', p_tenant_id, 'product_id', p_product_id));
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$$;

COMMIT;
