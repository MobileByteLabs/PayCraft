-- 184_tenant_ga4_connection.sql
--
-- A tenant's Google Analytics 4 property, shown on the dashboard's Analytics page next to PayCraft's own funnel
-- (paycraft-paywall-analytics GOAL D4 / AC-12). PayCraft reads it with ONE platform service account that the tenant
-- adds as a Viewer on their property — so nothing secret is stored per tenant: only the property id and whether the
-- last check could read it. Idempotent.

CREATE TABLE IF NOT EXISTS public.tenant_ga4_connections (
  tenant_id   UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- The numeric GA4 property id (Admin ▸ Property details), never the "G-…" measurement id.
  property_id TEXT NOT NULL CHECK (property_id ~ '^[0-9]{6,12}$'),
  verified_at TIMESTAMPTZ,
  last_error  TEXT CHECK (last_error IS NULL OR length(last_error) <= 300),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_ga4_connections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_ga4_connections_service_role ON public.tenant_ga4_connections;
CREATE POLICY tenant_ga4_connections_service_role ON public.tenant_ga4_connections FOR ALL
  USING (current_setting('role') = 'service_role') WITH CHECK (current_setting('role') = 'service_role');
DROP POLICY IF EXISTS tenant_ga4_connections_tenant_admin_select ON public.tenant_ga4_connections;
CREATE POLICY tenant_ga4_connections_tenant_admin_select ON public.tenant_ga4_connections FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT ta.tenant_id FROM public.tenant_admins ta WHERE ta.user_id = auth.uid()));

-- The dashboard's connect / re-check: stores the property and the result of a test report run just before.
CREATE OR REPLACE FUNCTION public.tenant_ga4_connection_save(
  p_tenant_id   UUID,
  p_property_id TEXT,
  p_verified    BOOLEAN,
  p_error       TEXT
) RETURNS public.tenant_ga4_connections
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_row tenant_ga4_connections;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  INSERT INTO tenant_ga4_connections (tenant_id, property_id, verified_at, last_error, updated_at)
  VALUES (p_tenant_id, p_property_id, CASE WHEN p_verified THEN now() END, CASE WHEN NOT p_verified THEN left(p_error, 300) END, now())
  ON CONFLICT (tenant_id) DO UPDATE SET
    property_id = EXCLUDED.property_id,
    verified_at = EXCLUDED.verified_at,
    last_error = EXCLUDED.last_error,
    updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.tenant_ga4_connection_delete(p_tenant_id UUID) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  DELETE FROM tenant_ga4_connections WHERE tenant_id = p_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.tenant_ga4_connection_save(UUID, TEXT, BOOLEAN, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.tenant_ga4_connection_delete(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_ga4_connection_save(UUID, TEXT, BOOLEAN, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_ga4_connection_delete(UUID) TO authenticated;
