-- 193_verified_sign_in_claims_test.sql — run inside a transaction that is rolled back.
--
-- A web (or app) sign-in verifies the provider token at identity-token/verify, then registers the device
-- with register_device — which must treat a client-supplied email as unverified (162). So every signed-in
-- web device stayed identity_verified = false, and the metering RPCs (allowance_status / allowance_spend,
-- balances) refused it for every verified user: ReelExport's /api/usage answered 503 (2026-11-13).
-- /verify now records a short-lived claim bound to the DEVICE ID; register_device consumes it.
BEGIN;
DO $$
DECLARE
  v_tenant UUID; v_key TEXT; v_res JSONB; v_verified BOOLEAN; v_email TEXT := 'claim-test-193@example.com';
BEGIN
  SELECT id, api_key_live INTO v_tenant, v_key FROM public.tenants WHERE api_key_live IS NOT NULL LIMIT 1;

  -- 1. No claim → unverified, exactly as before.
  v_res := public.register_device(v_email, 'web', 'Probe A', 'dev-aaaaaaaa-0001', 'live', v_key);
  SELECT identity_verified INTO v_verified FROM public.registered_devices WHERE device_token = v_res->>'server_token';
  IF v_verified THEN RAISE EXCEPTION 'FAIL: a device with no claim became verified'; END IF;

  -- 2. A claim for ANOTHER device id does not verify this one.
  PERFORM public.record_verified_sign_in(v_tenant, 'dev-bbbbbbbb-0002', v_email, 'google', 'sub-193');
  v_res := public.register_device(v_email, 'web', 'Probe C', 'dev-cccccccc-0003', 'live', v_key);
  SELECT identity_verified INTO v_verified FROM public.registered_devices WHERE device_token = v_res->>'server_token';
  IF v_verified THEN RAISE EXCEPTION 'FAIL: another device''s claim verified this device'; END IF;

  -- 3. The matching device id + email → verified, and the claim is used up.
  v_res := public.register_device(v_email, 'web', 'Probe B', 'dev-bbbbbbbb-0002', 'live', v_key);
  SELECT identity_verified INTO v_verified FROM public.registered_devices WHERE device_token = v_res->>'server_token';
  IF NOT COALESCE(v_verified, false) THEN RAISE EXCEPTION 'FAIL: the claimed device was not verified'; END IF;
  IF EXISTS (SELECT 1 FROM public.verified_sign_ins WHERE device_id = 'dev-bbbbbbbb-0002') THEN
    RAISE EXCEPTION 'FAIL: the claim was not consumed';
  END IF;

  -- 4. The same device signing in again (existing token) is verified too — the case of every user signed in before 193.
  PERFORM public.record_verified_sign_in(v_tenant, 'dev-aaaaaaaa-0001', v_email, 'google', 'sub-193');
  v_res := public.register_device(v_email, 'web', 'Probe A', 'dev-aaaaaaaa-0001', 'live', v_key);
  SELECT identity_verified INTO v_verified FROM public.registered_devices WHERE device_token = v_res->>'server_token';
  IF NOT COALESCE(v_verified, false) THEN RAISE EXCEPTION 'FAIL: re-signing in an existing device did not verify it'; END IF;

  -- 5. An expired claim does nothing.
  INSERT INTO public.verified_sign_ins (tenant_id, device_id, email, provider, auth_sub, expires_at)
  VALUES (v_tenant, 'dev-dddddddd-0004', v_email, 'google', 'sub-193', now() - interval '1 minute');
  v_res := public.register_device(v_email, 'web', 'Probe D', 'dev-dddddddd-0004', 'live', v_key);
  SELECT identity_verified INTO v_verified FROM public.registered_devices WHERE device_token = v_res->>'server_token';
  IF v_verified THEN RAISE EXCEPTION 'FAIL: an expired claim verified a device'; END IF;

  -- 6. Never client-reachable.
  IF has_function_privilege('anon', 'public.record_verified_sign_in(uuid,text,text,text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon can record a verified sign-in';
  END IF;
  IF has_table_privilege('anon', 'public.verified_sign_ins', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: anon can read verified sign-ins';
  END IF;

  -- 7. One person, one subject: the verified sign-in attached to the email subject register_device made.
  IF (SELECT count(DISTINCT subject_id) FROM public.entitlement_identities
       WHERE (kind = 'email' AND value = v_email) OR (kind = 'auth_user' AND value = 'sub-193')) <> 1 THEN
    RAISE EXCEPTION 'FAIL: the sign-in created a second subject for the same person';
  END IF;
  IF NOT (SELECT verified FROM public.entitlement_identities WHERE kind = 'email' AND value = v_email) THEN
    RAISE EXCEPTION 'FAIL: the attested email was left unverified';
  END IF;

  RAISE NOTICE 'PASS: 193 verified sign-in claims';
END $$;
ROLLBACK;
