-- Migration 148: one key per app — mint a MODE-LESS publishable key.
--
-- WHY. The SDK completed the one-key model: `PayCraft.initialize` admits any `pk_…`, and
-- `PayCraft.mode` resolves test/live as  modeOverride → legacy `pk_test_`/`pk_live_` prefix →
-- host build type. The build-type rule is the whole point — debug builds take test payment links,
-- release builds take live ones, with no configuration and no second key.
--
-- But provisioning still minted a PAIR, and nothing minted a mode-less key. An app taking its one
-- key from that pair therefore matched resolution STEP 2, so its mode was pinned by the prefix and
-- step 3 never applied: a debug build carrying the `pk_live_` key resolved LIVE and could take real
-- money in development. That is the exact defect the SDK's own KDoc cites against cappy, and it was
-- unreachable to fix from the client side — the key shape caused it.
--
-- WHAT CHANGES. `provision_app` and `rotate_api_key` mint `pk_<48 hex>` with no mode segment.
--
-- WHY THE SAME VALUE LANDS IN BOTH COLUMNS. `tenants.api_key_test` and `api_key_live` are both
-- NOT NULL UNIQUE, and those are two SEPARATE per-column constraints, so one value may occupy both.
-- Tenant lookup is already `WHERE (api_key_test = p_api_key OR api_key_live = p_api_key)`
-- (migration 015), so a mode-less key resolves with NO lookup change and no new column — the
-- cheapest shape that delivers the model. `api_key_test = api_key_live` becomes the derivable
-- signal "this tenant is on the one-key model", which `rotate_api_key` reads below.
--
-- BACKWARD COMPATIBILITY, deliberately total:
--   • Existing tenants are NOT touched. No backfill, no UPDATE. A legacy pair keeps working, keeps
--     pinning mode by prefix, and keeps being honoured by the SDK (resolution step 2) and by the
--     server (`x-paycraft-mode` absent → prefix fallback).
--   • Both function SIGNATURES are unchanged, so every existing caller compiles and runs. Nothing
--     is DROPped — migration 147 dropped a 3-arg RPC while production still called it, and that
--     mistake is not repeated here.
--   • The returned jsonb keeps `api_key_test` and `api_key_live` (both now the same one key) so the
--     dashboard keeps rendering, and ADDS `api_key` as the canonical field to migrate to.
--
-- Idempotent: CREATE OR REPLACE only.

-- ── provision_app — the live app-creation path (dashboard POST /api/apps) ───────────────────────
CREATE OR REPLACE FUNCTION public.provision_app(p_app_name text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_user_id   UUID := auth.uid();
  v_email     TEXT;
  v_tenant_id UUID;
  -- ONE key, no mode segment: the SDK decides mode from the build type.
  v_api_key   TEXT := 'pk_' || encode(gen_random_bytes(24), 'hex');
  v_wh_test   TEXT := 'whsec_test_' || encode(gen_random_bytes(24), 'hex');
  v_wh_live   TEXT := 'whsec_live_' || encode(gen_random_bytes(24), 'hex');
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;

  -- Webhook secrets stay mode-scoped: those are PROVIDER-side registrations, one per mode at the
  -- provider, and nothing about the client's key shape changes that.
  INSERT INTO tenants (
    name, api_key_test, api_key_live,
    webhook_secret_test, webhook_secret_live,
    owner_email, plan, subscriber_limit
  ) VALUES (
    p_app_name, v_api_key, v_api_key,
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
    'api_key',      v_api_key,   -- canonical: the ONE key to ship
    'api_key_test', v_api_key,   -- legacy field names, same value — kept so existing callers render
    'api_key_live', v_api_key,
    'webhook_url',  format('/functions/v1/stripe-webhook/%s', v_tenant_id)
  );
END;
$function$;

COMMENT ON FUNCTION public.provision_app(text) IS
  'Create an app: tenant row, owner membership, ONE mode-less publishable key (pk_<hex>, stored in '
  'both api_key_* columns), mode-scoped webhook secrets, the default provider lanes '
  '(google_play/app_store/stripe, active but not connected) and the platform routing that uses '
  'them. Mode is resolved by the SDK from the build type, not from the key prefix (migration 148).';

-- ── rotate_api_key — must not re-split a one-key tenant ────────────────────────────────────────
-- Signature unchanged: (p_user_id uuid, p_mode text).
--
-- A one-key tenant is detected by `api_key_test = api_key_live`. Rotating only one column there
-- would silently SPLIT it back into a pair, re-pinning mode by prefix and reintroducing the very
-- defect this migration removes — so for those tenants both columns move together and p_mode is
-- accepted-but-irrelevant (there is one key; it has no mode to rotate independently).
CREATE OR REPLACE FUNCTION rotate_api_key(
    p_user_id UUID,
    p_mode    TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
    v_tenant_id UUID;
    v_new_key   TEXT;
    v_one_key   BOOLEAN;
BEGIN
    SELECT ta.tenant_id INTO v_tenant_id
    FROM tenant_admins ta
    WHERE ta.user_id = p_user_id
      AND ta.role IN ('owner', 'admin');

    IF v_tenant_id IS NULL THEN
        RETURN jsonb_build_object('error', 'unauthorized');
    END IF;

    -- Validate p_mode BEFORE branching, so a typo is still rejected for a one-key tenant rather
    -- than silently rotating something the caller did not ask for.
    IF p_mode NOT IN ('test', 'live') THEN
        RETURN jsonb_build_object('error', 'invalid mode, use test or live');
    END IF;

    SELECT (api_key_test = api_key_live) INTO v_one_key
    FROM tenants WHERE id = v_tenant_id;

    IF v_one_key THEN
        v_new_key := 'pk_' || encode(gen_random_bytes(24), 'hex');
        UPDATE tenants
           SET api_key_test = v_new_key,
               api_key_live = v_new_key,
               updated_at   = now()
         WHERE id = v_tenant_id;
        RETURN jsonb_build_object('new_key', v_new_key, 'mode', 'one-key', 'rotated_both', true);
    END IF;

    -- Legacy two-key tenant: unchanged behaviour, mode-prefixed, one column at a time.
    v_new_key := 'pk_' || p_mode || '_' || encode(gen_random_bytes(24), 'hex');
    IF p_mode = 'test' THEN
        UPDATE tenants SET api_key_test = v_new_key, updated_at = now() WHERE id = v_tenant_id;
    ELSE
        UPDATE tenants SET api_key_live = v_new_key, updated_at = now() WHERE id = v_tenant_id;
    END IF;

    RETURN jsonb_build_object('new_key', v_new_key, 'mode', p_mode, 'rotated_both', false);
END;
$$;

COMMENT ON FUNCTION rotate_api_key(uuid, text) IS
  'Rotate a tenant publishable key. One-key tenants (api_key_test = api_key_live) get a new '
  'mode-less pk_<hex> in BOTH columns and p_mode is irrelevant; legacy two-key tenants rotate the '
  'named mode only, as before (migration 148).';

-- Grants: CREATE OR REPLACE preserves existing privileges, so these are already in force from
-- migrations 048 and 038. Re-stated explicitly and idempotently so a `supabase db reset` replay
-- cannot leave either function callable-by-nobody if migration ordering ever shifts.
GRANT EXECUTE ON FUNCTION public.provision_app(text)      TO authenticated;
GRANT EXECUTE ON FUNCTION rotate_api_key(uuid, text)      TO authenticated;
