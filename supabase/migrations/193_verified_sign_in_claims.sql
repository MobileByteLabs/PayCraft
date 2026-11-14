-- 193 — a device signed in with a VERIFIED provider token is registered as identity-verified.
--
-- THE GAP
-- 162 gated the money RPCs (balances; later allowance_status / allowance_spend, 189) on
-- registered_devices.identity_verified, written only by register_verified_device — reached only from the
-- identity-verify function for apps that run their OWN auth (tenants.auth_issuer_url). The SDKs' own
-- sign-in (Google / Apple through identity-token/verify, both web and KMP) verifies the provider token and
-- then calls register_device, which must treat the email it is given as unverified. So every SDK sign-in
-- produced an unverified device, and for any user whose identity is verified the metering RPCs refused
-- them: ReelExport's /api/usage answered 503 "device identity not verified for a verified subject"
-- (2026-11-13) for a paying user signed in with Google.
--
-- THE FIX
-- identity-token/verify, after checking the token's signature, records a short-lived single-use CLAIM
-- bound to the device's random id (the SDK now sends it): (tenant, device_id, verified email, provider,
-- provider subject). register_device consumes a matching claim and marks the device verified, linking the
-- provider subject exactly as register_verified_device does. Without a claim nothing changes.
--
-- WHY THIS KEEPS 162's PROTECTION
-- An impersonator calling register_device with a victim's email has no claim: claims are written only by
-- the service role after a signature check, and one matches only the device id that was sent WITH the
-- verified token — a random value that lives on the victim's device — within 10 minutes, once.
--
-- Idempotent throughout.

CREATE TABLE IF NOT EXISTS public.verified_sign_ins (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  device_id   TEXT        NOT NULL CHECK (length(device_id) BETWEEN 8 AND 128),
  email       TEXT        NOT NULL,
  provider    TEXT        NOT NULL CHECK (provider IN ('google', 'apple')),
  auth_sub    TEXT        NOT NULL CHECK (btrim(auth_sub) <> ''),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT now() + interval '10 minutes'
);
CREATE INDEX IF NOT EXISTS verified_sign_ins_lookup_idx ON public.verified_sign_ins (tenant_id, device_id);
ALTER TABLE public.verified_sign_ins ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.verified_sign_ins FROM anon, authenticated;

-- Written by identity-token/verify (service role) AFTER the provider token's signature was checked.
CREATE OR REPLACE FUNCTION public.record_verified_sign_in(
  p_tenant_id UUID,
  p_device_id TEXT,
  p_email     TEXT,
  p_provider  TEXT,
  p_auth_sub  TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM verified_sign_ins WHERE expires_at < now();
  DELETE FROM verified_sign_ins WHERE tenant_id = p_tenant_id AND device_id = p_device_id;
  INSERT INTO verified_sign_ins (tenant_id, device_id, email, provider, auth_sub)
  VALUES (p_tenant_id, p_device_id, lower(btrim(p_email)), p_provider, p_auth_sub);
END;
$$;
REVOKE EXECUTE ON FUNCTION public.record_verified_sign_in(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.record_verified_sign_in(UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;

-- Internal: consume a matching claim and mark [p_token]'s device verified (register_verified_device's writes).
CREATE OR REPLACE FUNCTION public._apply_verified_sign_in(
  p_tenant_id UUID,
  p_device_id TEXT,
  p_email     TEXT,
  p_token     TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim     verified_sign_ins%ROWTYPE;
  v_subject   UUID;
  v_by_email  UUID;
  v_by_auth   UUID;
BEGIN
  IF p_tenant_id IS NULL OR p_device_id IS NULL OR p_token IS NULL THEN RETURN; END IF;
  DELETE FROM verified_sign_ins
  WHERE tenant_id = p_tenant_id AND device_id = p_device_id
    AND email = lower(btrim(p_email)) AND expires_at >= now()
  RETURNING * INTO v_claim;
  IF v_claim.id IS NULL THEN RETURN; END IF;

  -- Attach to what exists; never create a second subject for the same person (entitlement_identity_link
  -- refuses merges, and every user signed in before 193 already has an email subject from register_device).
  SELECT subject_id INTO v_by_email FROM entitlement_identities
   WHERE kind = 'email' AND COALESCE(provider, '') = '' AND value = v_claim.email;
  SELECT subject_id INTO v_by_auth FROM entitlement_identities
   WHERE kind = 'auth_user' AND COALESCE(provider, '') = '' AND value = v_claim.auth_sub;

  IF v_by_auth IS NOT NULL AND v_by_email IS NOT NULL AND v_by_auth <> v_by_email THEN
    -- Two subjects for one person: merging is an operator decision (154). Use the attested one, as 162 does.
    v_subject := v_by_auth;
  ELSIF v_by_auth IS NOT NULL THEN
    v_subject := v_by_auth;
    PERFORM entitlement_identity_link(v_subject, 'email', NULL, v_claim.email, true);
  ELSIF v_by_email IS NOT NULL THEN
    v_subject := v_by_email;
    PERFORM entitlement_identity_link(v_subject, 'auth_user', NULL, v_claim.auth_sub, true);
  ELSE
    v_subject := entitlement_subject_resolve('auth_user', NULL, v_claim.auth_sub, true);
    PERFORM entitlement_identity_link(v_subject, 'email', NULL, v_claim.email, true);
  END IF;
  -- The provider just attested this address.
  UPDATE entitlement_identities SET verified = true
   WHERE subject_id = v_subject AND kind = 'email' AND COALESCE(provider, '') = '' AND value = v_claim.email;

  UPDATE registered_devices
     SET identity_verified = true, subject_id = v_subject
   WHERE device_token = p_token;
END;
$$;
REVOKE EXECUTE ON FUNCTION public._apply_verified_sign_in(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;

-- register_device: 178's body unchanged, plus the claim at both exits (a new device, and the same device
-- signing in again — every user signed in before 193 becomes verified on their next sign-in).
CREATE OR REPLACE FUNCTION register_device(
    p_email       TEXT,
    p_platform    TEXT,
    p_device_name TEXT,
    p_device_id   TEXT,
    p_mode        TEXT DEFAULT 'live',
    p_api_key     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id  UUID;
    v_token      TEXT;
    v_same       TEXT;
    v_latest_name TEXT;
    v_latest_seen TIMESTAMPTZ;
    v_active     INT;
    v_max        INT;
    v_conflict   BOOLEAN := false;
    v_subject    UUID;
    v_list       JSONB;
BEGIN
    v_tenant_id := resolve_tenant(p_api_key);
    v_subject   := entitlement_subject_resolve('email', NULL, p_email, false);
    SELECT COALESCE(max_active_devices, 1) INTO v_max FROM tenants WHERE id = v_tenant_id;
    v_max := COALESCE(v_max, 1);

    -- The same device signing in again (same name + platform, still active) keeps its seat and token.
    SELECT device_token INTO v_same
    FROM registered_devices
    WHERE ((v_subject IS NOT NULL AND subject_id = v_subject) OR lower(email) = lower(p_email))
      AND mode = p_mode
      AND is_active = true
      AND (tenant_id IS NOT DISTINCT FROM v_tenant_id)
      AND device_name IS NOT DISTINCT FROM p_device_name
      AND platform = p_platform
    ORDER BY registered_at DESC
    LIMIT 1;
    IF v_same IS NOT NULL THEN
        PERFORM _apply_verified_sign_in(v_tenant_id, p_device_id, p_email, v_same);
        RETURN jsonb_build_object(
            'server_token', v_same,
            'conflict', false,
            'conflicting_device_name', null,
            'conflicting_last_seen', null,
            'max_devices', v_max,
            'active_devices', '[]'::jsonb
        );
    END IF;

    SELECT count(*) INTO v_active
    FROM registered_devices
    WHERE ((v_subject IS NOT NULL AND subject_id = v_subject) OR lower(email) = lower(p_email))
      AND mode = p_mode
      AND is_active = true
      AND (tenant_id IS NOT DISTINCT FROM v_tenant_id);
    v_conflict := v_active >= v_max;

    IF v_conflict THEN
        SELECT device_name, last_seen_at INTO v_latest_name, v_latest_seen
        FROM registered_devices
        WHERE ((v_subject IS NOT NULL AND subject_id = v_subject) OR lower(email) = lower(p_email))
          AND mode = p_mode AND is_active = true
          AND (tenant_id IS NOT DISTINCT FROM v_tenant_id)
        ORDER BY registered_at DESC
        LIMIT 1;
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
                   'device_ref',    id::text,
                   'device_name',   device_name,
                   'platform',      platform,
                   'registered_at', registered_at,
                   'last_seen_at',  last_seen_at
               ) ORDER BY COALESCE(last_seen_at, registered_at) DESC), '[]'::jsonb)
        INTO v_list
        FROM registered_devices
        WHERE ((v_subject IS NOT NULL AND subject_id = v_subject) OR lower(email) = lower(p_email))
          AND mode = p_mode AND is_active = true
          AND (tenant_id IS NOT DISTINCT FROM v_tenant_id);
    END IF;

    v_token := 'srv_' || replace(gen_random_uuid()::text, '-', '');

    INSERT INTO registered_devices
        (email, device_token, platform, device_name, device_id, mode, is_active, tenant_id, subject_id)
    VALUES
        (lower(p_email), v_token, p_platform, p_device_name, p_device_id, p_mode,
         NOT v_conflict, v_tenant_id, v_subject);

    PERFORM _apply_verified_sign_in(v_tenant_id, p_device_id, p_email, v_token);

    RETURN jsonb_build_object(
        'server_token', v_token,
        'conflict', v_conflict,
        'conflicting_device_name', v_latest_name,
        'conflicting_last_seen',   v_latest_seen,
        'max_devices', v_max,
        'active_devices', COALESCE(v_list, '[]'::jsonb)
    );
END;
$$;
