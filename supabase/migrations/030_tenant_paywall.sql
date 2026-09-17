-- 030_tenant_paywall.sql — Per-tenant paywall design configuration
BEGIN;

DO $$ BEGIN
  CREATE TYPE paywall_template AS ENUM ('minimal','premium','dark','gradient');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE branding_mode AS ENUM ('attribution','none','custom');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS tenant_paywall (
  tenant_id     UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  template      paywall_template NOT NULL DEFAULT 'minimal',
  theme_jsonb   JSONB NOT NULL DEFAULT '{}'::jsonb,
  branding      branding_mode NOT NULL DEFAULT 'attribution',
  custom_footer TEXT,
  primary_color TEXT,
  font_family   TEXT,
  support_email TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tenant_paywall ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_paywall_read ON tenant_paywall;
CREATE POLICY tenant_paywall_read ON tenant_paywall FOR SELECT
  USING (tenant_id IN (SELECT ta.tenant_id FROM tenant_admins ta WHERE ta.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION tenant_paywall_get(p_tenant_id UUID)
RETURNS tenant_paywall
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT * FROM tenant_paywall WHERE tenant_id = p_tenant_id;
$$;

CREATE OR REPLACE FUNCTION tenant_paywall_upsert(p_row JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO tenant_paywall(tenant_id, template, theme_jsonb, branding, custom_footer,
                             primary_color, font_family, support_email)
  VALUES (
    (p_row->>'tenant_id')::UUID,
    COALESCE((p_row->>'template')::paywall_template, 'minimal'),
    COALESCE(p_row->'theme_jsonb', '{}'::jsonb),
    COALESCE((p_row->>'branding')::branding_mode, 'attribution'),
    p_row->>'custom_footer',
    p_row->>'primary_color',
    p_row->>'font_family',
    p_row->>'support_email'
  )
  ON CONFLICT (tenant_id) DO UPDATE
    SET template      = EXCLUDED.template,
        theme_jsonb   = EXCLUDED.theme_jsonb,
        branding      = EXCLUDED.branding,
        custom_footer = EXCLUDED.custom_footer,
        primary_color = EXCLUDED.primary_color,
        font_family   = EXCLUDED.font_family,
        support_email = EXCLUDED.support_email,
        updated_at    = now();
END;
$$;

-- Auto-seed a default paywall row when a tenant is provisioned (idempotent)
CREATE OR REPLACE FUNCTION tenant_paywall_ensure_default(p_tenant_id UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO tenant_paywall(tenant_id) VALUES (p_tenant_id) ON CONFLICT DO NOTHING;
$$;

COMMIT;
