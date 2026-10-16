-- Assertions for migration 155 (subject-aware entitlement resolution).
--
--   supabase start
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f supabase/tests/155_entitlement_subject_resolution_test.sql
--
-- Two things are being proved, and the second matters more than the first:
--
--   1. the cross-device fix works  — one human, two emails, premium on both devices
--   2. nothing else widened       — tenant, mode, status and period filters still refuse
--
-- (2) is the risk of this migration. The new predicate is `subject OR email`, and an OR is exactly
-- how a filter gets accidentally bypassed. Every refusal below is a filter that must survive.

BEGIN;

CREATE TEMP TABLE _t(name TEXT, ok BOOLEAN) ON COMMIT DROP;

DO $$
DECLARE
  v_tenant   UUID;
  v_tenant2  UUID;
  v_key      TEXT;
  v_subject  UUID;
  tok_a      TEXT;
  tok_b      TEXT;
  tok_other  TEXT;
BEGIN
  -- A tenant to scope everything to. resolve_tenant(NULL) is what the RPCs use with no api key.
  -- Use a REAL api key: resolve_tenant(NULL) yields NULL, which scopes every RPC to NULL-tenant
  -- rows only. Passing the key exercises the path a real client takes.
  SELECT id, api_key_live INTO v_tenant, v_key FROM tenants ORDER BY created_at LIMIT 1;
  -- A REAL second tenant: tenant_id is a foreign key, so a random uuid cannot stand in for
  -- "someone else's tenant".
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('other-tenant-fixture','other@test.local','pk_'||gen_random_uuid(),'pk_'||gen_random_uuid(),
          'wh_'||gen_random_uuid(),'wh_'||gen_random_uuid()) RETURNING id INTO v_tenant2;

  -- ── Fixture: ONE human, TWO emails ─────────────────────────────────────────────────────────────
  -- Bought under the Google address; later signs in on a second device under an Apple relay one.
  INSERT INTO subscriptions (email, provider, plan, status, mode, current_period_end, tenant_id)
  VALUES ('human-a@test.local', 'stripe', 'monthly', 'active', 'live', now() + interval '30 days', v_tenant);

  v_subject := entitlement_subject_resolve('email', NULL, 'human-a@test.local', false);
  UPDATE subscriptions SET subject_id = v_subject WHERE email = 'human-a@test.local';

  -- Device 1 under the purchasing email.
  tok_a := (register_device('human-a@test.local', 'android', 'Pixel', 'dev-a', 'live', v_key))->>'server_token';

  -- Device 2 under the relay email, linked to the SAME subject by a VERIFIED apple identity —
  -- which is what a real sign-in would do.
  tok_b := (register_device('relay-xyz@privaterelay.appleid.com', 'ios', 'iPhone', 'dev-b', 'live', v_key))->>'server_token';
  PERFORM entitlement_identity_link(v_subject, 'oauth', 'apple', 'apple-sub-human-a', true);
  UPDATE registered_devices SET subject_id = v_subject
   WHERE email = 'relay-xyz@privaterelay.appleid.com';

  -- ── 1. The fix ─────────────────────────────────────────────────────────────────────────────────
  INSERT INTO _t VALUES ('premium-on-purchasing-device', is_premium(tok_a, v_key));
  INSERT INTO _t VALUES ('premium-on-second-device-different-email', is_premium(tok_b, v_key));
  INSERT INTO _t VALUES ('get_subscription-resolves-via-subject',
    (SELECT count(*) FROM get_subscription(tok_b, v_key)) = 1);
  INSERT INTO _t VALUES ('check_premium_with_device-agrees',
    (check_premium_with_device(tok_b, v_key))->>'is_premium' = 'true');

  -- A freshly registered, non-conflicting device must be ACTIVE.
  --
  -- Regression guard. `registered_devices.is_active` DEFAULTS TO FALSE and every read RPC filters
  -- `is_active = true`, so a register_device that forgets the column makes every new device resolve
  -- as not-premium — a paying customer installing on a new phone silently loses access, with no
  -- error anywhere. An earlier draft of 155 did exactly that; this assertion is why it was caught.
  INSERT INTO _t VALUES ('new-device-is-active',
    (SELECT is_active FROM registered_devices WHERE device_token = tok_a));

  -- …and a CONFLICTING device must be registered INACTIVE: it gets a token to drive the transfer
  -- flow, but must not be entitled until the user resolves the conflict.
  -- Self-contained: its own email, so it cannot be perturbed by the fixture above. The first
  -- device must be ACTIVE; a second device with a different name must CONFLICT and be INACTIVE.
  DECLARE
    tok_1 TEXT;
    tok_2 TEXT;
    res_2 JSONB;
  BEGIN
    tok_1 := (register_device('conflict@test.local','android','PhoneA','dc1','live', v_key))->>'server_token';
    res_2 := register_device('conflict@test.local','ios','PhoneB','dc2','live', v_key);
    tok_2 := res_2->>'server_token';
    INSERT INTO _t VALUES ('second-device-conflicts', (res_2->>'conflict') = 'true');
    INSERT INTO _t VALUES ('conflicting-device-is-inactive',
      NOT (SELECT is_active FROM registered_devices WHERE device_token = tok_2));
    INSERT INTO _t VALUES ('first-device-stays-active',
      (SELECT is_active FROM registered_devices WHERE device_token = tok_1));
  END;

  -- ── 2. Nothing else widened ────────────────────────────────────────────────────────────────────

  -- An unrelated human must NOT inherit it. This is the whole risk of an OR predicate.
  tok_other := (register_device('stranger@test.local', 'android', 'Pixel', 'dev-c', 'live', v_key))->>'server_token';
  INSERT INTO _t VALUES ('stranger-is-not-premium', NOT is_premium(tok_other, v_key));

  -- MODE filter: a test-mode device must not see a live subscription.
  INSERT INTO _t VALUES ('mode-filter-holds', NOT is_premium(
    (register_device('human-a@test.local', 'android', 'Pixel-test', 'dev-t', 'test', v_key))->>'server_token',
    NULL));

  -- STATUS filter: cancel it and premium must stop, by subject as well as by email.
  UPDATE subscriptions SET status = 'canceled' WHERE subject_id = v_subject;
  INSERT INTO _t VALUES ('status-filter-holds', NOT is_premium(tok_b, v_key));
  UPDATE subscriptions SET status = 'active' WHERE subject_id = v_subject;

  -- PERIOD filter: an expired subscription is not premium even with a matching subject.
  UPDATE subscriptions SET current_period_end = now() - interval '1 day' WHERE subject_id = v_subject;
  INSERT INTO _t VALUES ('period-filter-holds', NOT is_premium(tok_b, v_key));
  UPDATE subscriptions SET current_period_end = now() + interval '30 days' WHERE subject_id = v_subject;

  -- TENANT filter: the subscription belongs to another tenant → not premium here.
  UPDATE subscriptions SET tenant_id = v_tenant2 WHERE subject_id = v_subject;
  INSERT INTO _t VALUES ('tenant-filter-holds', NOT is_premium(tok_b, v_key));
  UPDATE subscriptions SET tenant_id = v_tenant WHERE subject_id = v_subject;

  -- ── 3. The fallback: a row with NO subject must still resolve by email ─────────────────────────
  -- This is what makes the migration safe to deploy before any backfill completes.
  UPDATE subscriptions      SET subject_id = NULL WHERE email = 'human-a@test.local';
  UPDATE registered_devices SET subject_id = NULL WHERE email = 'human-a@test.local';
  INSERT INTO _t VALUES ('email-fallback-when-subject-null', is_premium(tok_a, v_key));

  -- ── 4. Device conflict unifies across emails ───────────────────────────────────────────────────
  -- Two emails of one human must not yield two independent "only device" slots.
  UPDATE registered_devices SET subject_id = v_subject WHERE email IN
    ('human-a@test.local','relay-xyz@privaterelay.appleid.com');
  INSERT INTO _t VALUES ('conflict-detected-across-emails',
    (register_device('relay-xyz@privaterelay.appleid.com', 'android', 'OtherPhone', 'dev-d', 'live', v_key))
      ->>'conflict' = 'true');
END $$;

DO $$
DECLARE failed INT; r RECORD;
BEGIN
  SELECT count(*) INTO failed FROM _t WHERE NOT ok OR ok IS NULL;
  FOR r IN SELECT * FROM _t ORDER BY name LOOP
    RAISE NOTICE '% %', CASE WHEN r.ok THEN 'PASS' ELSE 'FAIL' END, r.name;
  END LOOP;
  IF failed > 0 THEN
    RAISE EXCEPTION '155 subject-resolution assertions: % failed', failed;
  END IF;
  RAISE NOTICE 'ALL % assertions passed', (SELECT count(*) FROM _t);
END $$;

ROLLBACK;
