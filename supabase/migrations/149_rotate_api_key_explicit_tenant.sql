-- Migration 149: rotate_api_key must name its tenant, and REFUSE ambiguity rather than guess.
--
-- THE BUG. `rotate_api_key(p_user_id, p_mode)` resolves the tenant like this:
--
--     SELECT ta.tenant_id INTO v_tenant_id
--     FROM tenant_admins ta
--     WHERE ta.user_id = p_user_id AND ta.role IN ('owner','admin');
--
-- No ORDER BY, no LIMIT. In plpgsql a multi-row `SELECT … INTO` does NOT error — it silently takes
-- the first row the planner happens to return. Migration 048 introduced multi-app accounts
-- (tenant_admins became many-per-user) and this function was never updated, so since then it has
-- been able to rotate a DIFFERENT app than the caller meant.
--
-- Measured on production 2026-10-08: user ad978e03 admins SEVEN tenants — Affirmly, cappy,
-- Hacker Keyboard, PayCraft Sample, Reels Downloader, Status Saver, test. A call intending cappy
-- could have rotated Reels Downloader, invalidating the publishable key baked into every already
-- released build of it. That is why automation (`/idea-paycraft`) must not call the 2-arg form.
--
-- THE FIX, in two parts:
--   1. A new 3-arg form that NAMES the tenant and verifies the caller admins it.
--   2. The existing 2-arg form keeps working for single-app accounts and REFUSES when the caller
--      admins more than one tenant, instead of picking one. Refusing is the whole point: a wrong
--      rotation is unrecoverable (the old key is gone), so ambiguity must fail closed.
--
-- NO DROP, and the 3-arg form deliberately has NO DEFAULT on p_tenant_id. A default would make
-- `rotate_api_key(user, mode)` ambiguous between the two overloads and every existing 2-arg call
-- site would start failing with "function is not unique" — the shape of the mistake migration 147
-- made when it dropped a 3-arg RPC production still called.

-- ── 3-arg: explicit tenant. What automation must use. ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION rotate_api_key(
    p_user_id   UUID,
    p_mode      TEXT,
    p_tenant_id UUID
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
    v_is_admin BOOLEAN;
    v_new_key  TEXT;
    v_one_key  BOOLEAN;
BEGIN
    IF p_mode NOT IN ('test', 'live') THEN
        RETURN jsonb_build_object('error', 'invalid mode, use test or live');
    END IF;

    -- Authorisation is per-TENANT, not "does this user admin anything".
    SELECT EXISTS (
        SELECT 1 FROM tenant_admins
        WHERE user_id = p_user_id
          AND tenant_id = p_tenant_id
          AND role IN ('owner', 'admin')
    ) INTO v_is_admin;

    IF NOT v_is_admin THEN
        RETURN jsonb_build_object('error', 'unauthorized');
    END IF;

    SELECT (api_key_test = api_key_live) INTO v_one_key FROM tenants WHERE id = p_tenant_id;
    IF v_one_key IS NULL THEN
        RETURN jsonb_build_object('error', 'tenant not found');
    END IF;

    -- One-key tenant (migration 148): both columns move together, or rotating one would silently
    -- re-split it into a pair and reintroduce a mode-pinned key.
    IF v_one_key THEN
        v_new_key := 'pk_' || encode(gen_random_bytes(24), 'hex');
        UPDATE tenants
           SET api_key_test = v_new_key, api_key_live = v_new_key, updated_at = now()
         WHERE id = p_tenant_id;
        RETURN jsonb_build_object(
            'new_key', v_new_key, 'mode', 'one-key', 'rotated_both', true, 'tenant_id', p_tenant_id
        );
    END IF;

    -- Legacy pair: rotate only the named tier. Both tiers are a supported shape — the SDK selects
    -- between them from the build identity (PlatformInfo.buildKind), so each is independently live.
    v_new_key := 'pk_' || p_mode || '_' || encode(gen_random_bytes(24), 'hex');
    IF p_mode = 'test' THEN
        UPDATE tenants SET api_key_test = v_new_key, updated_at = now() WHERE id = p_tenant_id;
    ELSE
        UPDATE tenants SET api_key_live = v_new_key, updated_at = now() WHERE id = p_tenant_id;
    END IF;

    RETURN jsonb_build_object(
        'new_key', v_new_key, 'mode', p_mode, 'rotated_both', false, 'tenant_id', p_tenant_id
    );
END;
$$;

COMMENT ON FUNCTION rotate_api_key(uuid, text, uuid) IS
  'Rotate a tenant publishable key, tenant named EXPLICITLY. The form automation must use: the '
  '2-arg form cannot disambiguate a multi-app owner. One-key tenants rotate both columns together.';

-- ── 2-arg: unchanged signature, but ambiguity now REFUSES instead of guessing ─────────────────
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
    v_count     INT;
BEGIN
    SELECT count(*) INTO v_count
    FROM tenant_admins
    WHERE user_id = p_user_id AND role IN ('owner', 'admin');

    IF v_count = 0 THEN
        RETURN jsonb_build_object('error', 'unauthorized');
    END IF;

    -- FAIL CLOSED. The old code took whichever row came first and rotated it; a rotation cannot be
    -- undone, so guessing risks invalidating a key embedded in every released build of an app the
    -- caller never mentioned.
    IF v_count > 1 THEN
        RETURN jsonb_build_object(
            'error', 'ambiguous_tenant',
            'detail', format(
                'caller admins %s tenants; call rotate_api_key(p_user_id, p_mode, p_tenant_id)', v_count
            ),
            'tenant_count', v_count
        );
    END IF;

    SELECT tenant_id INTO v_tenant_id
    FROM tenant_admins
    WHERE user_id = p_user_id AND role IN ('owner', 'admin');

    RETURN rotate_api_key(p_user_id, p_mode, v_tenant_id);
END;
$$;

COMMENT ON FUNCTION rotate_api_key(uuid, text) IS
  'Rotate a publishable key for a SINGLE-app account. Returns error=ambiguous_tenant when the '
  'caller admins more than one tenant — use the 3-arg form (migration 149). Previously it silently '
  'rotated an arbitrary one of them.';

GRANT EXECUTE ON FUNCTION rotate_api_key(uuid, text)       TO authenticated;
GRANT EXECUTE ON FUNCTION rotate_api_key(uuid, text, uuid) TO authenticated;
