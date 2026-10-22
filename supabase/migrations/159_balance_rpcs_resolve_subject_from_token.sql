-- 159_balance_rpcs_resolve_subject_from_token.sql
--
-- SECURITY FIX to 157/70124cf, and the reason the balance RPCs have no Kotlin caller.
--
-- ## The hole
--
-- 70124cf correctly removed `p_tenant_id` from the client-facing balance functions, reasoning that
-- "a p_tenant_id parameter would let any caller read ANOTHER tenant's balances by passing their
-- id". It then left `p_subject_id UUID` as a caller-supplied parameter on both, and granted them
-- to `anon, authenticated`:
--
--     entitlement_balance_get  (p_api_key, p_subject_id, p_sku)              -> anon, authenticated
--     entitlement_balance_spend(p_api_key, p_subject_id, p_sku, qty, idem)   -> anon, authenticated
--
-- Both are SECURITY DEFINER, so they bypass RLS. The tenant is pinned by the key, but the SUBJECT
-- is accepted verbatim and never checked against the caller. The publishable key ships inside every
-- client binary, so within one tenant ANY caller holding it can read — and SPEND — another user's
-- balance given their subject UUID. That is the exact defect 70124cf fixed, one level down, and
-- `spend` makes it a drain rather than a leak.
--
-- ## Why no Kotlin ever called these
--
-- `entitlement_subject_resolve` is granted to `service_role` only, so a legitimate client cannot
-- obtain its OWN subject id. The only way to populate `p_subject_id` from a device was to already
-- know a UUID the client is never given. The missing caller and the vulnerability are one defect:
-- the parameter should never have been the client's to supply.
--
-- ## The fix
--
-- Client-facing overloads that take the DEVICE TOKEN and resolve the subject server-side, exactly
-- as `is_premium` / `get_subscription` / `check_premium_with_device` have since migration 155:
-- resolve_tenant(p_api_key), then look the subject up from `registered_devices.device_token`
-- scoped to that tenant. A caller can then only ever reach the subject its own token maps to.
--
-- The subject-taking signatures are KEPT (the webhook grant path and the dashboard hold a real
-- subject id and no device token) but REVOKED from anon/authenticated, so they become
-- service_role-only like `entitlement_balance_of_tenant` already is.
--
-- Overload resolution is by named parameters through PostgREST, and the two name SETS are
-- disjoint ({p_api_key,p_subject_id,p_sku} vs {p_server_token,p_api_key,p_sku}), so both can
-- coexist without ambiguity.
--
-- Idempotent: CREATE OR REPLACE / GRANT / REVOKE are all safe to re-run (CLAUDE.md migration rules).

-- ── 1. internal: device token -> subject, tenant-scoped ──────────────────────────────────────────
-- Mirrors the lookup inside is_premium (155). STABLE + SECURITY DEFINER because `registered_devices`
-- is RLS-protected and the client role cannot read it directly. service_role only: this is a
-- building block for the functions below, never a client entry point.
CREATE OR REPLACE FUNCTION public.entitlement_subject_of_token(
    p_server_token TEXT,
    p_tenant       UUID
)
RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT subject_id
  FROM registered_devices
  WHERE device_token = p_server_token
    AND is_active = true
    AND (tenant_id IS NOT DISTINCT FROM p_tenant)
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.entitlement_subject_of_token(TEXT, UUID) IS
  'Resolve a registered device token to its entitlement subject, scoped to the tenant. Internal '
  '(service_role only) — the client-facing balance RPCs call it so the subject is never a parameter.';

-- ── 2. client-facing balance read, subject derived from the token ────────────────────────────────
CREATE OR REPLACE FUNCTION public.entitlement_balance_get(
    p_server_token TEXT,
    p_api_key      TEXT,
    p_sku          TEXT
)
RETURNS INT
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant  UUID;
  v_subject UUID;
BEGIN
  v_tenant := resolve_tenant(p_api_key);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'unknown or inactive api key' USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  v_subject := entitlement_subject_of_token(p_server_token, v_tenant);
  -- An unknown/inactive token is 0, not an error: a signed-out or not-yet-registered client asking
  -- for its balance is an ordinary state, and the SDK already maps a failed read to 0 rather than a
  -- cached optimistic value. Raising here would make a normal cold start look like a fault.
  IF v_subject IS NULL THEN
    RETURN 0;
  END IF;

  RETURN entitlement_balance_of_tenant(v_tenant, v_subject, p_sku);
END;
$$;

-- ── 3. client-facing spend, subject derived from the token ───────────────────────────────────────
-- Delegates to the subject-taking implementation rather than restating it: the replay check, the
-- FOR UPDATE lock and the insufficient_balance contract are subtle and must not exist twice.
CREATE OR REPLACE FUNCTION public.entitlement_balance_spend(
    p_server_token    TEXT,
    p_api_key         TEXT,
    p_sku             TEXT,
    p_quantity        INT,
    p_idempotency_key TEXT
)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant  UUID;
  v_subject UUID;
BEGIN
  v_tenant := resolve_tenant(p_api_key);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'unknown or inactive api key' USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  v_subject := entitlement_subject_of_token(p_server_token, v_tenant);
  -- A spend, unlike a read, MUST fail loudly on an unresolvable token. Returning 0 would be
  -- indistinguishable from "spent, balance now 0" to a caller that is about to hand over goods.
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'unknown or inactive device token' USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  RETURN public.entitlement_balance_spend(p_api_key, v_subject, p_sku, p_quantity, p_idempotency_key);
END;
$$;

-- ── 4. grants ────────────────────────────────────────────────────────────────────────────────────
-- The token-taking overloads become the client surface.
GRANT EXECUTE ON FUNCTION public.entitlement_balance_get(TEXT, TEXT, TEXT)                TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.entitlement_balance_spend(TEXT, TEXT, TEXT, INT, TEXT)   TO anon, authenticated;

-- The subject-taking overloads stop being reachable from a client. They remain for the webhook /
-- dashboard paths, which hold a real subject id and no device token.
REVOKE EXECUTE ON FUNCTION public.entitlement_balance_get(TEXT, UUID, TEXT)               FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.entitlement_balance_spend(TEXT, UUID, TEXT, INT, TEXT)  FROM anon, authenticated;

REVOKE EXECUTE ON FUNCTION public.entitlement_subject_of_token(TEXT, UUID)                FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.entitlement_subject_of_token(TEXT, UUID)                TO service_role;

COMMENT ON FUNCTION public.entitlement_balance_get(TEXT, TEXT, TEXT) IS
  'CLIENT-FACING balance read. Tenant from the publishable key, subject from the device token — '
  'neither is a caller-supplied id. Returns 0 for an unresolvable token.';
COMMENT ON FUNCTION public.entitlement_balance_spend(TEXT, TEXT, TEXT, INT, TEXT) IS
  'CLIENT-FACING checked spend. Tenant from the key, subject from the device token. Delegates to '
  'the subject-taking implementation for the replay check, row lock and insufficient_balance error.';
