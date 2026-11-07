-- 162 — a device may only reach a verified subject's MONEY with a verified identity.
--
-- THE HOLE THIS CLOSES
-- `register_device(p_email, …)` is granted to `anon, authenticated` and resolves the subject from a
-- CLIENT-SUPPLIED email. `entitlement_subject_resolve` matches on (kind, provider, value) and
-- ignores verified-ness for the lookup, so an unverified claim returns the EXISTING subject —
-- including one created by a real, verified sign-in. With the publishable key (which ships in every
-- app binary) that is:
--
--   register_device(p_email: 'victim@example.com')  ->  device_token bound to the victim's subject
--     -> check_premium_with_device      -> inherits their premium
--     -> entitlement_balance_get/spend  -> reads and SPENDS their balance
--
-- Migration 159 closed exactly this on the balance RPCs (a caller may no longer name a subject ID).
-- The REGISTRATION path still accepts a subject's EMAIL. Same class, other door.
--
-- WHY THE FIX IS NOT "REFUSE UNVERIFIED CLAIMS"
-- The legitimate flow has the same shape: an app signs a user in with Google, reads their email,
-- and calls register_device with it. From this server's side that is an unverified claim on a
-- verified identity. Refusing it would break every signed-in user on every consumer. An
-- impersonation hole cannot be closed without an AUTHENTICATION MECHANISM — so this migration adds
-- one, and gates only the new money surface on it.
--
-- WHAT THIS MIGRATION DOES
--   1. tenants.auth_issuer_url — where a consumer's identity tokens can be VERIFIED (its JWKS).
--   2. registered_devices.identity_verified — did this device prove who it is?
--   3. The BALANCE RPCs refuse an unverified device when the subject has a verified identity.
--
-- WHAT IT DELIBERATELY DOES NOT DO
-- It does not change `check_premium_with_device`. Premium inheritance by email is the SAME hole and
-- is NOT fixed here, because every existing paying user reaches premium through the unverified email
-- path and gating it today would lock them out. Premium moves behind the token once consumers have
-- shipped an SDK that sends one — deliberately a later step, not an oversight. The balance can be
-- gated NOW precisely because it is new: no consumer has shipped a balance yet, so there is nobody
-- to break.
--
-- Idempotent throughout.

-- ── 1. where a tenant's identity tokens are verified ────────────────────────────────────────────
ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS auth_issuer_url TEXT;

COMMENT ON COLUMN public.tenants.auth_issuer_url IS
  'Base URL of the consumer app''s auth issuer, used to fetch its public JWKS and VERIFY identity '
  'tokens (a Supabase project: https://<ref>.supabase.co). NULL means this tenant has not enabled '
  'verified identity — its devices stay unverified and cannot reach a verified subject''s balance. '
  'Asymmetric (JWKS) on purpose: PayCraft never holds a consumer''s signing secret.';

-- ── 2. did this device prove who it is ──────────────────────────────────────────────────────────
ALTER TABLE public.registered_devices
  ADD COLUMN IF NOT EXISTS identity_verified BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.registered_devices.identity_verified IS
  'True only when this device registered by presenting an identity token this server VERIFIED '
  'against the tenant''s auth_issuer_url. A client cannot set it: register_device is reachable from '
  'anon and never writes it true. Only the identity-verify edge function (service_role) does.';

-- ── 3. does this subject have anything worth protecting ─────────────────────────────────────────
-- "Verified" here means an identity this server established itself — an OAuth/auth_user sign-in or
-- a store-attested account id. A subject with none of those has nothing to impersonate: it was
-- minted from the same kind of unverified claim the caller is making now.
CREATE OR REPLACE FUNCTION public.entitlement_subject_is_verified(p_subject UUID)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM entitlement_identities
    WHERE subject_id = p_subject AND verified = true
  );
$$;

-- ── 4. the gate ─────────────────────────────────────────────────────────────────────────────────
-- Resolve a device token to its subject, REFUSING when the device is unverified and the subject is.
-- Returns NULL for an unknown/inactive token (same contract as entitlement_subject_of_token) and
-- RAISES for the impersonation case, because the two deserve different answers: an unknown token is
-- an ordinary cold start, an unverified device reaching a verified subject's money is an attack or
-- a stale client, and silently returning 0 would teach the caller it had simply spent nothing.
CREATE OR REPLACE FUNCTION public.entitlement_subject_of_verified_token(
    p_server_token TEXT,
    p_tenant       UUID
)
RETURNS UUID
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subject  UUID;
  v_devverif BOOLEAN;
BEGIN
  SELECT subject_id, identity_verified INTO v_subject, v_devverif
  FROM registered_devices
  WHERE device_token = p_server_token
    AND is_active = true
    AND (tenant_id IS NOT DISTINCT FROM p_tenant)
  LIMIT 1;

  IF v_subject IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT v_devverif AND entitlement_subject_is_verified(v_subject) THEN
    RAISE EXCEPTION
      'device identity not verified for a verified subject — re-register with an identity token'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN v_subject;
END;
$$;

-- ── 5. point the MONEY RPCs at the gated resolver ───────────────────────────────────────────────
-- Bodies are otherwise identical to 159/161; only the subject lookup changes.
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
  v_subject := entitlement_subject_of_verified_token(p_server_token, v_tenant);
  IF v_subject IS NULL THEN
    RETURN 0;   -- unchanged: an unresolvable token reads as an empty balance
  END IF;
  RETURN public.entitlement_balance_get(p_api_key, v_subject, p_sku);
END;
$$;

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
  v_subject := entitlement_subject_of_verified_token(p_server_token, v_tenant);
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'unknown or inactive device token' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  RETURN public.entitlement_balance_spend(p_api_key, v_subject, p_sku, p_quantity, p_idempotency_key);
END;
$$;

CREATE OR REPLACE FUNCTION public.entitlement_balance_earn(
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
  v_tenant   UUID;
  v_subject  UUID;
  v_cap      INT;
  v_earned   INT;
  v_grant    INT;
BEGIN
  IF p_quantity IS NULL OR p_quantity < 1 THEN
    RAISE EXCEPTION 'quantity must be >= 1' USING ERRCODE = 'check_violation';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key is required' USING ERRCODE = 'null_value_not_allowed';
  END IF;

  v_tenant := resolve_tenant(p_api_key);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'unknown or inactive api key' USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  v_subject := entitlement_subject_of_verified_token(p_server_token, v_tenant);
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'unknown or inactive device token' USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  SELECT daily_earn_cap INTO v_cap
  FROM tenant_products
  WHERE tenant_id = v_tenant AND sku = p_sku AND active;

  IF v_cap IS NULL THEN
    RAISE EXCEPTION 'sku % does not allow activity earning (set tenant_products.daily_earn_cap)', p_sku
      USING ERRCODE = 'check_violation';
  END IF;

  v_earned := entitlement_activity_earned_today(v_tenant, v_subject, p_sku);
  v_grant  := LEAST(p_quantity, GREATEST(v_cap - v_earned, 0));

  IF v_grant > 0 THEN
    INSERT INTO entitlement_balance_ledger
      (tenant_id, subject_id, sku, delta, reason, stable_txn_id, idempotency_key)
    VALUES
      (v_tenant, v_subject, p_sku, v_grant, 'activity', NULL, btrim(p_idempotency_key))
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;
  END IF;

  RETURN public.entitlement_balance_get(p_api_key, v_subject, p_sku);
END;
$$;

-- ── 6. the verified-registration writer (service_role only) ─────────────────────────────────────
-- Called ONLY by the identity-verify edge function, AFTER it has verified the token's signature
-- against the tenant's JWKS. It takes the already-verified claims, never a raw token: keeping JWT
-- verification out of plpgsql means the trust boundary is one auditable TypeScript file.
CREATE OR REPLACE FUNCTION public.register_verified_device(
    p_tenant_id   UUID,
    p_auth_sub    TEXT,
    p_email       TEXT,
    p_device_token TEXT,
    p_platform    TEXT,
    p_device_name TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subject UUID;
BEGIN
  IF p_auth_sub IS NULL OR btrim(p_auth_sub) = '' THEN
    RAISE EXCEPTION 'auth subject is required' USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- auth_user, not email: the provider's immutable subject id is the identity, and an email is a
  -- mutable alias a user can change. Marked verified because the signature was checked.
  v_subject := entitlement_subject_resolve('auth_user', NULL, p_auth_sub, true);

  -- Link the email too, also verified, so a purchase made under that address finds this subject.
  IF p_email IS NOT NULL AND btrim(p_email) <> '' THEN
    PERFORM entitlement_identity_link(v_subject, 'email', NULL, p_email, true);
  END IF;

  INSERT INTO registered_devices
    (device_token, email, platform, device_name, is_active, identity_verified, subject_id, tenant_id)
  VALUES
    (p_device_token, COALESCE(p_email, p_auth_sub), p_platform, p_device_name, true, true, v_subject, p_tenant_id)
  ON CONFLICT (device_token) DO UPDATE
    SET subject_id = EXCLUDED.subject_id,
        tenant_id  = EXCLUDED.tenant_id,
        is_active  = true,
        identity_verified = true;

  RETURN v_subject;
END;
$$;

-- ── 7. grants ───────────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.entitlement_balance_get(TEXT, TEXT, TEXT)              TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.entitlement_balance_spend(TEXT, TEXT, TEXT, INT, TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.entitlement_balance_earn(TEXT, TEXT, TEXT, INT, TEXT)  TO anon, authenticated;

-- Never client-reachable: a client that could write identity_verified would defeat the whole gate.
REVOKE EXECUTE ON FUNCTION public.register_verified_device(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.register_verified_device(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.entitlement_subject_of_verified_token(TEXT, UUID) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.entitlement_subject_of_verified_token(TEXT, UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION public.entitlement_subject_is_verified(UUID)             FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.entitlement_subject_is_verified(UUID)             TO service_role;

COMMENT ON FUNCTION public.entitlement_subject_of_verified_token(TEXT, UUID) IS
  'Device token -> subject, REFUSING an unverified device when the subject has a verified identity. '
  'NULL for an unknown token; RAISES insufficient_privilege for the impersonation case.';
