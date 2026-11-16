-- Assertions for migration 196 (a monthly grant PER PLAN on the 195 allowance — ReelExport Plus / Pro / Max).
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/196_allowance_plan_grants_test.sql
BEGIN;
DO $$
DECLARE
  t UUID; kl TEXT; sp UUID; sm UUID; so UUID; j JSONB; st JSONB;
  tplus CONSTANT TEXT := 'dev-token-196-plus-aaaaaaaaaaaa';
  tmax  CONSTANT TEXT := 'dev-token-196-max-bbbbbbbbbbbbb';
  told  CONSTANT TEXT := 'dev-token-196-old-ccccccccccccc';
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('allowance-196','a196@test.local','pk_test_'||gen_random_uuid(),'pk_live_'||gen_random_uuid(),'w','w')
  RETURNING id, api_key_live INTO t, kl;
  INSERT INTO entitlement_subjects DEFAULT VALUES RETURNING id INTO sp;
  INSERT INTO entitlement_subjects DEFAULT VALUES RETURNING id INTO sm;
  INSERT INTO entitlement_subjects DEFAULT VALUES RETURNING id INTO so;
  INSERT INTO registered_devices (email, device_token, platform, mode, is_active, tenant_id, subject_id)
  VALUES ('plus@x.test', tplus, 'web', 'live', true, t, sp), ('max@x.test', tmax, 'web', 'live', true, t, sm), ('old@x.test', told, 'web', 'live', true, t, so);
  INSERT INTO subscriptions (email, provider, plan, status, current_period_end, mode, tenant_id, subject_id) VALUES
    ('plus@x.test', 'razorpay', 'plus-monthly', 'active', now() + interval '20 days', 'live', t, sp),
    ('max@x.test',  'stripe',   'max5-monthly', 'active', now() + interval '20 days', 'live', t, sm),
    ('old@x.test',  'stripe',   'pro-annual',   'trialing', now() + interval '200 days', 'live', t, so);

  -- Pro (and any plan not listed) keeps the tenant-wide grant; listed plans get their own.
  PERFORM allowance_configure(t, 'credits', 0, ARRAY['credits'], 300);
  PERFORM allowance_set_plan_grants(t, 'credits', '{"plus-monthly": 100, "max5-monthly": 1500}'::jsonb);

  -- 1. Plus spends from its own 100 and is refused past it (no pack).
  st := allowance_status(tplus, kl, 'credits');
  IF (st->>'grant_per_month')::INT <> 100 THEN RAISE EXCEPTION 'FAIL: plus grant %', st; END IF;
  j := allowance_spend_units(tplus, kl, 'credits', 100, 'p1');
  IF j->>'source' <> 'pro' OR (j->>'period_units')::INT <> 100 THEN RAISE EXCEPTION 'FAIL: plus spend %', j; END IF;
  IF allowance_spend_units(tplus, kl, 'credits', 1, 'p2')->>'source' <> 'refused' THEN RAISE EXCEPTION 'FAIL: plus spent past its grant'; END IF;

  -- 2. Max 5x gets 1,500.
  j := allowance_spend_units(tmax, kl, 'credits', 1200, 'm1');
  IF j->>'source' <> 'pro' OR (j->>'period_units')::INT <> 1200 THEN RAISE EXCEPTION 'FAIL: max spend %', j; END IF;
  IF (allowance_status(tmax, kl, 'credits')->>'grant_remaining')::INT <> 300 THEN RAISE EXCEPTION 'FAIL: max remaining'; END IF;

  -- 3. A plan with no row (pro-annual) falls back to pro_per_month — 195 behaviour unchanged.
  IF (allowance_status(told, kl, 'credits')->>'grant_per_month')::INT <> 300 THEN RAISE EXCEPTION 'FAIL: fallback grant'; END IF;

  -- 4. Clearing the map restores the tenant-wide grant for everyone.
  PERFORM allowance_set_plan_grants(t, 'credits', NULL);
  IF (allowance_status(tplus, kl, 'credits')->>'grant_per_month')::INT <> 300 THEN RAISE EXCEPTION 'FAIL: cleared map'; END IF;

  -- 5. Grants must be non-negative whole numbers.
  BEGIN
    PERFORM allowance_set_plan_grants(t, 'credits', '{"plus-monthly": -1}'::jsonb);
    RAISE EXCEPTION 'FAIL: negative grant accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;

  RAISE NOTICE 'PASS 196_allowance_plan_grants';
END $$;
ROLLBACK;
