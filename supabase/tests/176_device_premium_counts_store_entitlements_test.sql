-- Assertions for migration 176 (a signed-in device's premium check counts store entitlements).
--
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f supabase/tests/176_device_premium_counts_store_entitlements_test.sql
--
-- Against 155 the store cases fail: a Play subscriber with no `subscriptions` row reads not-premium.

BEGIN;

CREATE TEMP TABLE _t(name TEXT, ok BOOLEAN) ON COMMIT DROP;

DO $$
DECLARE
  v_tenant  UUID;
  v_tenant2 UUID;
  v_key     TEXT;
  tok_play  TEXT;
  tok_exp   TEXT;
  tok_other TEXT;
  tok_none  TEXT;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('store-premium-176','t176@test.local','pk_'||gen_random_uuid(),'pk_'||gen_random_uuid(),
          'wh_'||gen_random_uuid(),'wh_'||gen_random_uuid()) RETURNING id, api_key_test INTO v_tenant, v_key;
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('store-premium-176-b','t176b@test.local','pk_'||gen_random_uuid(),'pk_'||gen_random_uuid(),
          'wh_'||gen_random_uuid(),'wh_'||gen_random_uuid()) RETURNING id INTO v_tenant2;

  -- A Play subscriber: entitlement record only, NO subscriptions row (the reels-downloader case).
  INSERT INTO entitlement_records (app_user_id, tenant_id, provider, product_id, stable_txn_id, canonical_state,
                                   expires_at, will_renew, is_sandbox, latest_event_ts)
  VALUES ('Play.Buyer@Test.local', v_tenant, 'google_play', 'pro_monthly', 'txn-play-1', 'active',
          now() + interval '5 minutes', true, true, now());
  -- Expired store entitlement.
  INSERT INTO entitlement_records (app_user_id, tenant_id, provider, product_id, stable_txn_id, canonical_state,
                                   expires_at, will_renew, is_sandbox, latest_event_ts)
  VALUES ('expired@test.local', v_tenant, 'google_play', 'pro_monthly', 'txn-exp-1', 'active',
          now() - interval '1 minute', false, true, now() - interval '1 hour');
  -- Active entitlement, but in ANOTHER tenant.
  INSERT INTO entitlement_records (app_user_id, tenant_id, provider, product_id, stable_txn_id, canonical_state,
                                   expires_at, will_renew, is_sandbox, latest_event_ts)
  VALUES ('other-app@test.local', v_tenant2, 'google_play', 'pro_monthly', 'txn-other-1', 'active',
          now() + interval '30 days', true, false, now());

  tok_play  := (register_device('play.buyer@test.local', 'android', 'Pixel', 'dev-176-a', 'test', v_key))->>'server_token';
  tok_exp   := (register_device('expired@test.local',    'android', 'Pixel', 'dev-176-b', 'test', v_key))->>'server_token';
  tok_other := (register_device('other-app@test.local',  'android', 'Pixel', 'dev-176-c', 'test', v_key))->>'server_token';
  tok_none  := (register_device('nobody@test.local',     'android', 'Pixel', 'dev-176-d', 'test', v_key))->>'server_token';

  INSERT INTO _t VALUES ('check-premium-counts-active-play-entitlement',
    (check_premium_with_device(tok_play, v_key))->>'is_premium' = 'true');
  INSERT INTO _t VALUES ('is-premium-counts-active-play-entitlement', is_premium(tok_play, v_key));
  INSERT INTO _t VALUES ('email-match-is-case-insensitive',
    (check_premium_with_device(tok_play, v_key))->>'is_premium' = 'true');
  INSERT INTO _t VALUES ('expired-store-entitlement-not-premium',
    (check_premium_with_device(tok_exp, v_key))->>'is_premium' = 'false');
  INSERT INTO _t VALUES ('other-tenants-entitlement-not-premium',
    (check_premium_with_device(tok_other, v_key))->>'is_premium' = 'false');
  INSERT INTO _t VALUES ('no-entitlement-not-premium', NOT is_premium(tok_none, v_key));

  -- PSP path unchanged.
  INSERT INTO subscriptions (email, provider, plan, status, mode, current_period_end, tenant_id)
  VALUES ('nobody@test.local', 'stripe', 'monthly', 'active', 'test', now() + interval '30 days', v_tenant);
  INSERT INTO _t VALUES ('stripe-subscription-still-premium',
    (check_premium_with_device(tok_none, v_key))->>'is_premium' = 'true');

  -- The helper is not callable by clients.
  INSERT INTO _t VALUES ('helper-not-executable-by-anon',
    NOT has_function_privilege('anon', 'public._store_entitlement_premium(uuid,text)', 'EXECUTE'));
END $$;

DO $$
DECLARE failed INT; r RECORD;
BEGIN
  SELECT count(*) INTO failed FROM _t WHERE NOT ok OR ok IS NULL;
  FOR r IN SELECT * FROM _t ORDER BY name LOOP
    RAISE NOTICE '% %', CASE WHEN r.ok THEN 'PASS' ELSE 'FAIL' END, r.name;
  END LOOP;
  IF failed > 0 THEN RAISE EXCEPTION '176 store-premium assertions: % failed', failed; END IF;
  RAISE NOTICE 'ALL % assertions passed', (SELECT count(*) FROM _t);
END $$;

ROLLBACK;
