-- Assertions for migration 191 (Stripe status resolves an ATTACHED provider account).
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/191_stripe_status_attached_account_test.sql
BEGIN;
-- encrypt_provider_key refuses the dev-default passphrase; a throwaway one, rolled back with the rest.
UPDATE public.paycraft_secrets_config SET passphrase = 'test-191-' || gen_random_uuid()::text;
DO $$
DECLARE t UUID; t2 UUID; u UUID := gen_random_uuid(); a UUID; r RECORD; n INT;
BEGIN
  INSERT INTO auth.users (id, email) VALUES (u, 's191@test.local');
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('stripe-191','s191@test.local','pk_test_'||gen_random_uuid(),'pk_live_'||gen_random_uuid(),'w','w') RETURNING id INTO t;
  INSERT INTO tenant_admins (tenant_id, user_id) VALUES (t, u);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, true);

  -- 1. No Stripe at all → no row (genuinely not connected).
  SELECT count(*) INTO n FROM tenant_stripe_provider_status(t);
  IF n <> 0 THEN RAISE EXCEPTION 'FAIL: unconnected tenant must return no row, got %', n; END IF;

  -- 2. An ATTACHED org account (no keys on the app's own row) → connected, live first.
  --    Before 191 this returned no row, so product sync skipped Stripe ("Stripe is not connected").
  INSERT INTO provider_accounts (owner_user_id, provider, label, credential_enc, config)
  VALUES (u, 'stripe', 'org stripe', encrypt_provider_key(json_build_object(
            'live_secret', 'sk_live_191', 'live_key_id', 'pk_live_191',
            'test_secret', 'sk_test_191', 'test_key_id', 'pk_test_191')::text),
          '{}'::jsonb)
  RETURNING id INTO a;
  INSERT INTO tenant_providers (tenant_id, provider, is_active, provider_account_id) VALUES (t, 'stripe', true, a);
  SELECT * INTO r FROM tenant_stripe_provider_status(t);
  IF r.source IS DISTINCT FROM 'manual' THEN RAISE EXCEPTION 'FAIL: attached account must read as connected, got %', r.source; END IF;
  IF r.livemode IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: live secret present → livemode must be true'; END IF;

  -- 3. It agrees with the resolver checkout uses (the whole point: one answer on every path).
  SELECT count(*) INTO n FROM tenant_psp_credential_resolve(t, 'stripe', 'live') WHERE secret_key IS NOT NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL: resolver and status disagree'; END IF;

  -- 4. Another account's admin still cannot read it.
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('other-191','o191@test.local','pk_test_'||gen_random_uuid(),'pk_live_'||gen_random_uuid(),'w','w') RETURNING id INTO t2;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  BEGIN
    PERFORM * FROM tenant_stripe_provider_status(t);
    RAISE EXCEPTION 'FAIL: a non-admin read the status';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;   -- 'forbidden' is the expected refusal
  END;

  RAISE NOTICE 'PASS 191: unconnected → none · attached account → connected (live) · agrees with resolver · non-admin refused';
END $$;
ROLLBACK;
