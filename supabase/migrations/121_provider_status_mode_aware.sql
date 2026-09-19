-- 121_provider_status_mode_aware.sql
--
-- `tenant_providers_status.connected` reported a LIVE-only provider as NOT CONNECTED.
--
-- The previous body was:
--     SELECT tp.test_key_id, tp.live_key_id, (tp.test_key_id IS NOT NULL)
--
-- i.e. "connected" meant *has a TEST key id*. A tenant configured for live — live_key_id and
-- live_secret_key_enc present, test slots empty, which is the normal shape for a production
-- merchant — was reported disconnected by every caller of this RPC.
--
-- OBSERVED CONSEQUENCE, not a hypothetical: the product sync consults this before pushing, so it
-- skipped every product with `razorpay: skipped — "Razorpay is not connected for this tenant"`
-- while the credentials were sitting in the row. The drain then counted those products as synced,
-- so the operator was told "Synced 3 item(s)" about three products that were never pushed, and the
-- drift finding it was meant to clear survived every retry. One wrong predicate produced a silent
-- no-op AND a false success report.
--
-- FIX: connected means a usable key pair EXISTS, in either mode. The per-mode ids are still returned
-- so a caller that genuinely cares which mode is configured can decide for itself — that judgement
-- belongs to the caller (checkout must not silently transact live against a test key), not to a
-- boolean named `connected`.
--
-- Deliberately NOT narrowed to "live only": a test-mode tenant mid-integration is connected, and
-- flipping the bug to the other mode would just move it.

CREATE OR REPLACE FUNCTION public.tenant_providers_status(p_tenant_id uuid, p_provider text)
RETURNS TABLE(test_key_id text, live_key_id text, connected boolean)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  SELECT tp.test_key_id,
         tp.live_key_id,
         -- A key ID alone is not a credential: the id is public (rzp_live_…, pk_live_…) while the
         -- secret is what actually authenticates. Require BOTH halves of at least one mode, so a
         -- half-written row — an interrupted save, a preview run — cannot read as connected.
         (
           (tp.live_key_id IS NOT NULL AND tp.live_secret_key_enc IS NOT NULL)
           OR
           (tp.test_key_id IS NOT NULL AND tp.test_secret_key_enc IS NOT NULL)
         ) AS connected
  FROM tenant_providers tp
  WHERE tp.tenant_id = p_tenant_id
    AND tp.provider = p_provider
    AND tp.is_active;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.tenant_providers_status(uuid, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.tenant_providers_status(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.tenant_providers_status(uuid, text) IS
  'Per-provider connection status. connected = a COMPLETE key pair (id + secret) exists in either '
  'mode; the per-mode ids are returned so the caller can decide mode-specific behaviour. Was '
  '(test_key_id IS NOT NULL), which reported live-only tenants as disconnected (migration 121).';
