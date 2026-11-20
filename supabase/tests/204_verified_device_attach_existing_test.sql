-- Assertions for migration 204 (identity-verify attaches to the existing subject).
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f supabase/tests/204_verified_device_attach_existing_test.sql
BEGIN;
DO $$
DECLARE t UUID; kl TEXT; tok_a TEXT; tok_b TEXT; s_email UUID; s UUID; s_new UUID; refused BOOLEAN := false;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live, max_active_devices)
  VALUES ('verify-204', 'v204@test.local', 'pk_test_'||gen_random_uuid(), 'pk_live_'||gen_random_uuid(), 'w', 'w', 5)
  RETURNING id, api_key_live INTO t, kl;

  -- 1. The FR-017 order: PayCraft sign-in first (email subject), then the app's own auth verifies the device.
  tok_a := register_device('Member@x.test', 'web', 'Chrome', 'dev-a', 'live', kl)->>'server_token';
  SELECT subject_id INTO s_email FROM entitlement_identities WHERE kind = 'email' AND value = 'member@x.test';
  s := register_verified_device(t, 'supa-uid-member', 'Member@x.test', tok_a, 'web', 'Chrome');
  IF s IS DISTINCT FROM s_email THEN RAISE EXCEPTION 'FAIL: verify minted a second subject instead of attaching to the email one'; END IF;
  IF NOT EXISTS (SELECT 1 FROM entitlement_identities WHERE subject_id = s_email AND kind = 'auth_user' AND value = 'supa-uid-member' AND verified)
    THEN RAISE EXCEPTION 'FAIL: auth id not linked to the existing subject'; END IF;
  IF NOT (SELECT identity_verified AND subject_id = s_email FROM registered_devices WHERE device_token = tok_a)
    THEN RAISE EXCEPTION 'FAIL: device not marked verified on the existing subject'; END IF;

  -- 2. Repeat call (next visit) is idempotent.
  IF register_verified_device(t, 'supa-uid-member', 'member@x.test', tok_a, 'web', 'Chrome') IS DISTINCT FROM s_email
    THEN RAISE EXCEPTION 'FAIL: second verify changed the subject'; END IF;

  -- 3. Nobody known yet: one subject minted, email linked to it.
  s_new := register_verified_device(t, 'supa-uid-fresh', 'fresh@x.test', 'tok-fresh-'||gen_random_uuid(), 'web', NULL);
  IF NOT EXISTS (SELECT 1 FROM entitlement_identities WHERE subject_id = s_new AND kind = 'email' AND value = 'fresh@x.test')
    THEN RAISE EXCEPTION 'FAIL: fresh email not linked to the minted subject'; END IF;

  -- 4. A browser signed in to PayCraft as B must not be handed to A.
  tok_b := register_device('other@x.test', 'web', 'Safari', 'dev-b', 'live', kl)->>'server_token';
  BEGIN
    PERFORM register_verified_device(t, 'supa-uid-member', 'member@x.test', tok_b, 'web', NULL);
  EXCEPTION WHEN insufficient_privilege THEN refused := true;
  END;
  IF NOT refused THEN RAISE EXCEPTION 'FAIL: another account''s device was moved'; END IF;
  IF (SELECT subject_id FROM registered_devices WHERE device_token = tok_b) = s_email
    THEN RAISE EXCEPTION 'FAIL: device B now resolves to member A'; END IF;

  -- 5. Still service-role only.
  IF has_function_privilege('anon', 'public.register_verified_device(uuid,text,text,text,text,text)', 'execute')
    THEN RAISE EXCEPTION 'FAIL: anon can call register_verified_device'; END IF;
  RAISE NOTICE 'ALL 9 assertions passed';
END $$;
ROLLBACK;
