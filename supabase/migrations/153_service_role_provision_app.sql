-- 153 — service-role-safe app provisioning, so a fresh app can be onboarded through the
-- management API with nothing but a `pcsk_` account key.
--
-- ## Why not `provision_app` (148)
--
-- It reads `auth.uid()` and raises `unauthenticated` when there is none, so the v1 API (service
-- role) cannot call it. Same shape as 152's two twins.
--
-- ## Why NOT `provision_tenant` (039) — the trap this function exists to avoid
--
-- `provision_tenant(p_user_id, …)` opens with:
--
--     SELECT tenant_id INTO v_existing FROM tenant_admins WHERE user_id = p_user_id LIMIT 1;
--     IF v_existing IS NOT NULL THEN RETURN (… that tenant …);
--
-- That is a FIRST-TENANT-ONLY guard. For an account that already has apps it silently returns the
-- oldest one instead of creating anything, so a caller onboarding app #8 is handed app #1 and
-- proceeds to seed products and attach providers onto it — cross-wiring a second app's billing
-- onto the first. It is idempotent per ACCOUNT, where the caller needs idempotent per APP.
-- `/idea-paycraft`'s runtime already carries a warning never to use it for this reason; this
-- function is the path that makes the warning unnecessary.
--
-- ## Actor derivation
--
-- The caller proves, via its key, that it administers `p_actor_tenant`. The new app is created
-- under THAT tenant's owner. So the account a new app lands in is derived from a tenant the key
-- already reaches, never passed in and trusted — there is no parameter that could name another
-- account's owner.
--
-- ## Idempotency is per (owner, app_name)
--
-- Re-running with the same name returns the existing app rather than minting a duplicate, which is
-- what makes an onboarding chain safe to retry. `created` says which happened.

-- ## Reuse is IDENTIFIER-FIRST, then case-insensitive name
--
-- Both halves are load-bearing, and both come from defects `/idea-paycraft` already hit:
--
--  * `app_identifier` (applicationId / bundle id) is the STABLE key and wins. A name can drift.
--  * The name fallback must be case-INSENSITIVE. cappy's row is `name='cappy'` while the app
--    profile resolves `APP_NAME='Cappy'`; an exact match MISSES and the create branch then mints a
--    SECOND cappy app with fresh keys, orphaning the real one (products, pricing rows, a published
--    paywall) and pointing the client at an empty tenant.
--
-- The name fallback exists because rows predating the `app_identifier` column have it NULL.


-- ── Defaults every app must have, applied on reuse as well as create ──────────────────────────
--
-- Both are idempotent and insert-only, so an operator's existing choice is never rewritten while
-- an app that predates them is repaired in place.
--
-- ROUTING IS NOT OPTIONAL. `provision_app` (148) seeds it; a hand-rolled INSERT does not, so an
-- app onboarded by the old psql path had NO fallback rule — and the first buyer its primary
-- provider cannot serve resolved no provider at all (the android-primary=Razorpay / US-buyer
-- case). That is why a failure here RAISES rather than being swallowed: onboarding something
-- known-broken is worse than stopping.
CREATE OR REPLACE FUNCTION public.ensure_app_defaults(p_tenant UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_routed INT;
BEGIN
  -- Functional-by-default paywall. Tolerated if absent: a missing default paywall degrades to the
  -- SDK's bundled seed, which still renders.
  BEGIN
    PERFORM tenant_paywall_ensure_default(p_tenant);
  EXCEPTION WHEN undefined_function THEN
    NULL;
  END;

  PERFORM tenant_routing_apply_defaults(p_tenant);

  SELECT count(*) INTO v_routed
  FROM tenant_routing_rules
  WHERE tenant_id = p_tenant AND platform IS NOT NULL;

  IF COALESCE(v_routed, 0) < 4 THEN
    RAISE EXCEPTION 'routing_defaults_incomplete: expected >=4 platform rules, found %', COALESCE(v_routed, 0)
      USING ERRCODE = 'data_exception';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_app_defaults(UUID) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_app_defaults(UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.provision_app_admin(
    p_actor_tenant   UUID,
    p_app_name       TEXT,
    p_app_identifier TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_owner     UUID;
  v_existing  UUID;
  v_by_name   UUID;
  v_email     TEXT;
  v_matched   TEXT;
  v_tenant_id UUID;
  v_api_key   TEXT := 'pk_' || encode(gen_random_bytes(24), 'hex');
  v_wh_test   TEXT := 'whsec_test_' || encode(gen_random_bytes(24), 'hex');
  v_wh_live   TEXT := 'whsec_live_' || encode(gen_random_bytes(24), 'hex');
BEGIN
  IF p_app_name IS NULL OR btrim(p_app_name) = '' THEN
    RAISE EXCEPTION 'app_name is required' USING ERRCODE = 'null_value_not_allowed';
  END IF;

  SELECT ta.user_id INTO v_owner
  FROM tenant_admins ta
  WHERE ta.tenant_id = p_actor_tenant AND ta.role = 'owner'
  LIMIT 1;

  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'no owner for the acting app' USING ERRCODE = 'no_data_found';
  END IF;

  -- 1) The stable key.
  IF p_app_identifier IS NOT NULL AND btrim(p_app_identifier) <> '' THEN
    SELECT t.id INTO v_existing
    FROM tenants t
    JOIN tenant_admins ta ON ta.tenant_id = t.id AND ta.user_id = v_owner AND ta.role = 'owner'
    WHERE t.app_identifier = btrim(p_app_identifier)
    ORDER BY t.created_at
    LIMIT 1;
    IF v_existing IS NOT NULL THEN v_matched := 'app_identifier'; END IF;
  END IF;

  -- 2) Case-insensitive name, for rows with no identifier yet.
  SELECT t.id INTO v_by_name
  FROM tenants t
  JOIN tenant_admins ta ON ta.tenant_id = t.id AND ta.user_id = v_owner AND ta.role = 'owner'
  WHERE lower(btrim(t.name)) = lower(btrim(p_app_name))
  ORDER BY t.created_at
  LIMIT 1;

  -- AMBIGUOUS: the two keys name DIFFERENT apps, so two rows claim this one. There is no unique
  -- constraint making that impossible, and picking either bills a real customer against an app
  -- nobody chose — so refuse and name both. A human merges or renames.
  IF v_existing IS NOT NULL AND v_by_name IS NOT NULL AND v_existing <> v_by_name THEN
    RAISE EXCEPTION 'tenant_identity_ambiguous: app_identifier -> %, name -> %', v_existing, v_by_name
      USING ERRCODE = 'cardinality_violation';
  END IF;

  IF v_existing IS NULL AND v_by_name IS NOT NULL THEN
    v_existing := v_by_name;
    v_matched  := 'name';
  END IF;

  IF v_existing IS NOT NULL THEN
    -- Backfill the stable key onto a row that matched by name, so the NEXT run matches on the key
    -- and never depends on the name again. Only when empty — never overwrite a different id.
    IF p_app_identifier IS NOT NULL AND btrim(p_app_identifier) <> '' THEN
      UPDATE tenants
         SET app_identifier = btrim(p_app_identifier), updated_at = now()
       WHERE id = v_existing AND (app_identifier IS NULL OR btrim(app_identifier) = '');
    END IF;
    PERFORM ensure_app_defaults(v_existing);
    RETURN jsonb_build_object(
      'tenant_id', v_existing, 'created', false,
      'app_name', p_app_name, 'matched_by', v_matched
    );
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_owner;

  INSERT INTO tenants (name, app_identifier, api_key_test, api_key_live,
                       webhook_secret_test, webhook_secret_live, owner_email, plan, subscriber_limit)
  VALUES (btrim(p_app_name), NULLIF(btrim(COALESCE(p_app_identifier, '')), ''),
          v_api_key, v_api_key, v_wh_test, v_wh_live, v_email, 'free', 100)
  RETURNING id INTO v_tenant_id;

  INSERT INTO tenant_admins (tenant_id, user_id, role)
  VALUES (v_tenant_id, v_owner, 'owner');

  -- The default provider lanes, active-but-unconnected, exactly as 148 creates them: a lane that
  -- does not exist cannot be reported as unconnected, and readiness would then look clean.
  INSERT INTO tenant_providers (tenant_id, provider, is_active)
  VALUES (v_tenant_id, 'stripe', true),
         (v_tenant_id, 'google_play', true),
         (v_tenant_id, 'app_store', true)
  ON CONFLICT (tenant_id, provider) DO NOTHING;

  PERFORM ensure_app_defaults(v_tenant_id);

  RETURN jsonb_build_object(
    'tenant_id', v_tenant_id,
    'created', true,
    'app_name', btrim(p_app_name),
    'app_identifier', NULLIF(btrim(COALESCE(p_app_identifier, '')), ''),
    -- PUBLISHABLE key. Safe to return and safe to embed in a client — that is its whole purpose.
    -- No secret or webhook value is returned here.
    'publishable_key', v_api_key
  );
END;
$$;

COMMENT ON FUNCTION public.provision_app_admin(UUID, TEXT, TEXT) IS
  'Create (or return) an app under the owner of the acting tenant, without a browser session. '
  'Service-role twin of provision_app. Idempotent per (owner, app_name) — unlike provision_tenant, '
  'whose first-tenant-only guard returns the account''s OLDEST app and cross-wires billing.';

REVOKE ALL ON FUNCTION public.provision_app_admin(UUID, TEXT, TEXT) FROM anon, authenticated, PUBLIC;
GRANT EXECUTE ON FUNCTION public.provision_app_admin(UUID, TEXT, TEXT) TO service_role;
