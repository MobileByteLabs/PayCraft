-- 204: identity-verify attaches to the person's EXISTING subject instead of minting a second one.
--
-- 162's register_verified_device resolved (or minted) an auth_user subject for the consumer's auth id and
-- then linked the email to it. Every member who signed in through PayCraft first already has an email
-- subject (register_device, 193), so the email link hit entitlement_identity_link's merge refusal and
-- identity-verify answered 500 "identity already resolves to a different subject" — for every existing
-- member, and for every new one too (the consumer's flow is PayCraft sign-in first, then verify). Seen
-- 2026-11-20 while wiring ReelExport's own Supabase sign-in (FR-017).
--
-- Now the same rule as 193's _apply_verified_sign_in: attach to what exists (auth id first, then email),
-- mint only when neither is known. One more refusal: a device token that is already signed in to a
-- DIFFERENT person is not moved — a browser signed in to PayCraft as A and to the app's auth as B must not
-- hand A's device (and its plan) to B.
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
  v_email    TEXT := NULLIF(lower(btrim(p_email)), '');
  v_subject  UUID;
  v_by_email UUID;
  v_by_auth  UUID;
  v_device   registered_devices%ROWTYPE;
BEGIN
  IF p_auth_sub IS NULL OR btrim(p_auth_sub) = '' THEN
    RAISE EXCEPTION 'auth subject is required' USING ERRCODE = 'null_value_not_allowed';
  END IF;

  SELECT subject_id INTO v_by_auth FROM entitlement_identities
   WHERE kind = 'auth_user' AND COALESCE(provider, '') = '' AND value = btrim(p_auth_sub);
  IF v_email IS NOT NULL THEN
    SELECT subject_id INTO v_by_email FROM entitlement_identities
     WHERE kind = 'email' AND COALESCE(provider, '') = '' AND value = v_email;
  END IF;

  IF v_by_auth IS NOT NULL THEN
    v_subject := v_by_auth;              -- two subjects for one person: the attested one wins (154/162/193)
    IF v_email IS NOT NULL AND v_by_email IS NULL THEN
      PERFORM entitlement_identity_link(v_subject, 'email', NULL, v_email, true);
    END IF;
  ELSIF v_by_email IS NOT NULL THEN
    v_subject := v_by_email;
    PERFORM entitlement_identity_link(v_subject, 'auth_user', NULL, btrim(p_auth_sub), true);
  ELSE
    v_subject := entitlement_subject_resolve('auth_user', NULL, btrim(p_auth_sub), true);
    IF v_email IS NOT NULL THEN
      PERFORM entitlement_identity_link(v_subject, 'email', NULL, v_email, true);
    END IF;
  END IF;
  IF v_email IS NOT NULL THEN
    UPDATE entitlement_identities SET verified = true
     WHERE subject_id = v_subject AND kind = 'email' AND COALESCE(provider, '') = '' AND value = v_email;
  END IF;

  SELECT * INTO v_device FROM registered_devices WHERE device_token = p_device_token;
  IF v_device.device_token IS NOT NULL
     AND v_device.subject_id IS DISTINCT FROM v_subject
     AND lower(v_device.email) IS DISTINCT FROM v_email THEN
    RAISE EXCEPTION 'device is signed in to a different account' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO registered_devices
    (device_token, email, platform, device_name, is_active, identity_verified, subject_id, tenant_id)
  VALUES
    (p_device_token, COALESCE(v_email, btrim(p_auth_sub)), p_platform, p_device_name, true, true, v_subject, p_tenant_id)
  ON CONFLICT (device_token) DO UPDATE
    SET subject_id = EXCLUDED.subject_id,
        tenant_id  = EXCLUDED.tenant_id,
        is_active  = true,
        identity_verified = true;

  RETURN v_subject;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.register_verified_device(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.register_verified_device(UUID, TEXT, TEXT, TEXT, TEXT, TEXT) TO service_role;
