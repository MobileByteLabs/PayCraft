-- 190 — which GA4 data streams belong to this tenant's app.
--
-- One GA4 property often holds several apps' streams (e.g. Reels Downloader's Android + iOS app streams
-- and Kreatwiz's web stream share property 473327398). Without a filter the Analytics page counts every
-- stream in the property. `stream_ids` limits each report to the tenant's own; empty = whole property.
-- Idempotent.

ALTER TABLE public.tenant_ga4_connections ADD COLUMN IF NOT EXISTS stream_ids TEXT[] NOT NULL DEFAULT '{}';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_ga4_connections_stream_ids_numeric') THEN
    ALTER TABLE public.tenant_ga4_connections ADD CONSTRAINT tenant_ga4_connections_stream_ids_numeric
      CHECK (cardinality(stream_ids) <= 20 AND array_to_string(stream_ids, ',') ~ '^([0-9]{6,15}(,[0-9]{6,15})*)?$');
  END IF;
END $$;

-- The save function gains the streams as an optional last argument (old callers keep working).
DROP FUNCTION IF EXISTS public.tenant_ga4_connection_save(UUID, TEXT, BOOLEAN, TEXT);
CREATE OR REPLACE FUNCTION public.tenant_ga4_connection_save(
  p_tenant_id   UUID,
  p_property_id TEXT,
  p_verified    BOOLEAN,
  p_error       TEXT,
  p_stream_ids  TEXT[] DEFAULT '{}'
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
  INSERT INTO tenant_ga4_connections (tenant_id, property_id, verified_at, last_error, stream_ids, updated_at)
  VALUES (p_tenant_id, p_property_id, CASE WHEN p_verified THEN now() END, CASE WHEN NOT p_verified THEN left(p_error, 300) END, coalesce(p_stream_ids, '{}'), now())
  ON CONFLICT (tenant_id) DO UPDATE SET
    property_id = EXCLUDED.property_id,
    verified_at = EXCLUDED.verified_at,
    last_error = EXCLUDED.last_error,
    stream_ids = EXCLUDED.stream_ids,
    updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.tenant_ga4_connection_save(UUID, TEXT, BOOLEAN, TEXT, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_ga4_connection_save(UUID, TEXT, BOOLEAN, TEXT, TEXT[]) TO authenticated, service_role;
