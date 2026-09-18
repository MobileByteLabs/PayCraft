-- 126_routing_defaults_on_provision.sql
--
-- Make the routing defaults REACHABLE. Migration 125 added
-- `tenant_routing_ensure_defaults`, granted it, documented it — and nothing ever called it. A
-- function that exists and is never invoked is indistinguishable from one that was never written:
-- every app created after 125 would still get a primary with no fallback, which is the exact gap
-- 125 was written to close.
--
-- This is a recurring failure shape in this codebase (a mechanism shipped without a caller), so the
-- fix is placed where it CANNOT be bypassed: inside app provisioning itself, not in one UI route
-- that a second creation path would skip.
--
-- ONE FUNCTION, AUTHORISED BY ITS CALLERS
-- `tenant_routing_apply_defaults` does the work with NO membership check, because every caller is an
-- already-authorised context: `provision_app` (which just created the tenant and made the caller its
-- owner) and the service-role onboarding/setup paths (where `auth.uid()` is NULL by construction).
-- Locked to service_role, so it cannot be reached directly from a browser session.
--
-- Still idempotent and still non-destructive: a platform that already has a rule is left exactly as
-- the operator set it.

CREATE OR REPLACE FUNCTION public.tenant_routing_apply_defaults(p_tenant_id uuid)
RETURNS TABLE(platform text, priority_methods text[], created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
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

REVOKE EXECUTE ON FUNCTION public.tenant_routing_apply_defaults(uuid) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.tenant_routing_apply_defaults(uuid) TO service_role;

COMMENT ON FUNCTION public.tenant_routing_apply_defaults(uuid) IS
  'Seed primary+fallback routing for any platform that has none. Idempotent and insert-only, so an '
  'operator choice is never rewritten. Callers must already have authorised the tenant: '
  'provision_app (owner just created) or the service-role onboarding/setup paths.';

-- `tenant_routing_ensure_defaults` (migration 125) is DROPPED, not kept as a thin wrapper.
--
-- It existed so an authenticated end user could seed their own defaults — and no client ever called
-- it. With provisioning doing the seeding, it has no caller at all, and a granted-to-`authenticated`
-- function nobody invokes is public surface with no purpose. Keeping it "just in case" is what
-- produced this whole class: a mechanism that looks shipped because it exists.
--
-- Safe to drop rather than deprecate: 125 has only ever been applied locally, so no deployed
-- environment holds a dependency on it. If an operator-facing "restore defaults" action is wanted
-- later, it comes back WITH the UI that calls it, in the same change.
DROP FUNCTION IF EXISTS public.tenant_routing_ensure_defaults(uuid);

-- Provisioning now seeds routing itself, so a new app is never fallback-less. Re-declared in full
-- (not patched) because CREATE OR REPLACE FUNCTION has no partial form; the only change is the
-- PERFORM below and the accompanying comment.
CREATE OR REPLACE FUNCTION public.provision_app(p_app_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user_id  UUID := auth.uid();
  v_email    TEXT;
  v_tenant_id UUID;
  v_api_test  TEXT := 'pk_test_' || encode(gen_random_bytes(24), 'hex');
  v_api_live  TEXT := 'pk_live_' || encode(gen_random_bytes(24), 'hex');
  v_wh_test   TEXT := 'whsec_test_' || encode(gen_random_bytes(24), 'hex');
  v_wh_live   TEXT := 'whsec_live_' || encode(gen_random_bytes(24), 'hex');
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  INSERT INTO tenants (
    name, api_key_test, api_key_live,
    webhook_secret_test, webhook_secret_live,
    owner_email, plan, subscriber_limit
  ) VALUES (
    p_app_name, v_api_test, v_api_live,
    v_wh_test, v_wh_live,
    v_email, 'free', 100
  )
  RETURNING id INTO v_tenant_id;

  INSERT INTO tenant_admins (tenant_id, user_id, role)
  VALUES (v_tenant_id, v_user_id, 'owner');

  -- Every platform gets a primary AND a fallback from the first second of the app's life. Doing it
  -- here rather than in the caller means a second creation path cannot forget it.
  PERFORM tenant_routing_apply_defaults(v_tenant_id);

  RETURN jsonb_build_object(
    'tenant_id',    v_tenant_id,
    'name',         p_app_name,
    'api_key_test', v_api_test,
    'api_key_live', v_api_live,
    'webhook_url',  format('/functions/v1/stripe-webhook/%s', v_tenant_id)
  );
END;
$function$;

COMMENT ON FUNCTION public.provision_app(text) IS
  'Create an app: tenant row, owner membership, API/webhook keys, and default platform routing '
  '(primary + fallback) via tenant_routing_apply_defaults.';
