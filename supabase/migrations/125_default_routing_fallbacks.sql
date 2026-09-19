-- 125_default_routing_fallbacks.sql
--
-- A new app gets a PRIMARY *and* a FALLBACK for every platform, without anyone opening the UI.
--
-- The fallback column existed and was almost always "None", so the first buyer a primary could not
-- serve got nothing at all. That is not hypothetical: with Android primary = Razorpay (INR-only), a
-- US buyer resolved no binding whatsoever and the SDK reported "no provider configured".
--
-- Defaults chosen to be the safe shape, not the clever one:
--   ios      app_store  -> stripe_card    native digital lane first (store policy), web as backstop
--   android  google_play -> stripe_card   same
--   desktop  stripe_card                  no native store exists
--   web      stripe_card                  "
-- A web PSP is the tail everywhere because it is the only lane that can serve a buyer in any
-- country once it has a price in their currency.
--
-- IDEMPOTENT + NON-DESTRUCTIVE: only inserts a rule for a platform that has NONE. A tenant that has
-- already chosen its routing — including a deliberate single-entry rule with no fallback — is never
-- rewritten. Filling in someone's explicit choice would be worse than the gap this closes.

CREATE OR REPLACE FUNCTION public.tenant_routing_ensure_defaults(p_tenant_id uuid)
RETURNS TABLE(platform text, priority_methods text[], created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_admins WHERE tenant_id=p_tenant_id AND user_id=auth.uid())
  THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  WITH defaults(platform, methods) AS (
    VALUES ('ios',     ARRAY['app_store','stripe_card']),
           ('android', ARRAY['google_play','stripe_card']),
           ('desktop', ARRAY['stripe_card']),
           ('web',     ARRAY['stripe_card'])
  ),
  ins AS (
    INSERT INTO tenant_routing_rules (tenant_id, platform, priority_methods, priority)
    SELECT p_tenant_id, d.platform, d.methods, 20
    FROM defaults d
    WHERE NOT EXISTS (
      SELECT 1 FROM tenant_routing_rules r
      WHERE r.tenant_id = p_tenant_id AND r.platform = d.platform
    )
    RETURNING platform, priority_methods
  )
  SELECT i.platform, i.priority_methods, true FROM ins i
  UNION ALL
  SELECT r.platform, r.priority_methods, false
  FROM tenant_routing_rules r
  WHERE r.tenant_id = p_tenant_id AND r.platform IS NOT NULL
    AND r.platform NOT IN (SELECT platform FROM ins);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.tenant_routing_ensure_defaults(uuid) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.tenant_routing_ensure_defaults(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.tenant_routing_ensure_defaults(uuid) IS
  'Insert primary+fallback routing rules for any platform that has none. Idempotent; never '
  'rewrites a tenant that already chose its routing.';
