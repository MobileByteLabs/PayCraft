-- 130_default_provider_lanes.sql
--
-- A new app arrives with its provider lanes already wired: Google Play for Android, StoreKit 2 /
-- App Store for iOS + macOS, Stripe for desktop and web.
--
-- WHAT WAS MISSING
-- Migration 126 gave every new app its ROUTING (`android -> google_play,stripe_card`, and so on),
-- but routing names providers that had no rows: `tenant_providers` was empty until an operator added
-- each one by hand. So the routing pointed at lanes that did not exist, the dashboard showed no
-- providers at all, and `/config` served none — the app had a paywall with nothing behind it.
--
-- WHAT "DEFAULT CONNECTED" CAN AND CANNOT MEAN
-- The rows are created ACTIVE, so the lanes are enabled and selectable the moment the app exists.
-- They are NOT marked connected, because connected is a claim about CREDENTIALS and this migration
-- has none to offer:
--
--   google_play  needs store_config.package_name   (the app's Play package)
--   app_store    needs store_config.bundle_id      (the app's bundle identifier)
--   stripe       needs a publishable/secret key pair
--
-- Writing a row that merely exists and calling it connected is precisely the defect
-- `isProviderConnected` was written to end: a provider that reads as connected but cannot charge
-- gets offered as routable, and a routing rule pointed at it sends real customers to a lane that
-- cannot take their money. So the lane is pre-wired; the one thing only the operator can supply
-- stays the operator's to supply.
--
-- Idempotent and non-destructive: a provider row that already exists is never touched, so an
-- operator's keys, links and is_active choice survive a re-run.

CREATE OR REPLACE FUNCTION public.tenant_providers_apply_defaults(p_tenant_id uuid)
RETURNS TABLE(provider text, created boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  RETURN QUERY
  WITH defaults(provider) AS (
    -- Exactly the providers the default routing names, and no others. Seeding a lane nobody routes
    -- to would put an unconfigurable row in the dashboard for every new app.
    VALUES ('google_play'), ('app_store'), ('stripe')
  ),
  ins AS (
    INSERT INTO tenant_providers (tenant_id, provider, is_active)
    SELECT p_tenant_id, d.provider, true
    FROM defaults d
    WHERE NOT EXISTS (
      SELECT 1 FROM tenant_providers tp
      WHERE tp.tenant_id = p_tenant_id AND tp.provider = d.provider
    )
    RETURNING provider
  )
  SELECT i.provider, true FROM ins i
  UNION ALL
  SELECT tp.provider, false
  FROM tenant_providers tp
  WHERE tp.tenant_id = p_tenant_id
    AND tp.provider IN (SELECT provider FROM defaults)
    AND tp.provider NOT IN (SELECT provider FROM ins);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.tenant_providers_apply_defaults(uuid) FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.tenant_providers_apply_defaults(uuid) TO service_role;

COMMENT ON FUNCTION public.tenant_providers_apply_defaults(uuid) IS
  'Create the default provider lanes (google_play, app_store, stripe) as ACTIVE rows for a tenant '
  'that has none. Never marks them connected — that requires credentials only the operator has — '
  'and never touches an existing row.';

-- Provisioning seeds providers alongside routing, so the two can never describe different worlds.
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

  -- Lanes first, then the routing that names them: an app is never created in a state where its
  -- routing points at providers that do not exist.
  PERFORM tenant_providers_apply_defaults(v_tenant_id);
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
  'Create an app: tenant row, owner membership, API/webhook keys, the default provider lanes '
  '(google_play/app_store/stripe, active but not connected) and the platform routing that uses them.';

-- Backfill: apps created before this migration have routing that names providers they do not have.
DO $$
DECLARE t record; added int; seeded int := 0;
BEGIN
  FOR t IN SELECT id, name FROM tenants LOOP
    SELECT count(*) INTO added FROM tenant_providers_apply_defaults(t.id) WHERE created;
    IF added > 0 THEN
      seeded := seeded + 1;
      RAISE NOTICE 'provider lanes: created % for tenant % (%)', added, t.name, t.id;
    END IF;
  END LOOP;
  RAISE NOTICE 'provider-lane backfill complete: % tenant(s) updated', seeded;
END $$;
