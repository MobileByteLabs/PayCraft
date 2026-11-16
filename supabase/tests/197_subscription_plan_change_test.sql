-- Assertions for migration 197 (subscriber plan change: pending plan + effective plan + the caller lookup).
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/197_subscription_plan_change_test.sql
BEGIN;
DO $$
DECLARE
  t UUID; kl TEXT; s UUID; sf UUID; r RECORD; sub UUID;
  tok  CONSTANT TEXT := 'dev-token-197-aaaaaaaaaaaaaaaa';
  tokf CONSTANT TEXT := 'dev-token-197-ffffffffffffffff';
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('change-197','c197@test.local','pk_test_'||gen_random_uuid(),'pk_live_'||gen_random_uuid(),'w','w')
  RETURNING id, api_key_live INTO t, kl;
  INSERT INTO entitlement_subjects DEFAULT VALUES RETURNING id INTO s;
  INSERT INTO entitlement_subjects DEFAULT VALUES RETURNING id INTO sf;
  INSERT INTO registered_devices (email, device_token, platform, mode, is_active, tenant_id, subject_id)
  VALUES ('plus@x.test', tok, 'web', 'live', true, t, s), ('free@x.test', tokf, 'web', 'live', true, t, sf);
  INSERT INTO subscriptions (email, provider, provider_subscription_id, plan, status, current_period_end, mode, tenant_id, subject_id)
  VALUES ('plus@x.test', 'razorpay', 'sub_RZ1', 'plus-monthly', 'active', now() + interval '20 days', 'live', t, s)
  RETURNING id INTO sub;
  PERFORM allowance_configure(t, 'credits', 0, ARRAY['credits'], 300);
  PERFORM allowance_set_plan_grants(t, 'credits', '{"plus-monthly": 100, "max5-monthly": 1500}'::jsonb);

  -- 1. The caller lookup finds the live subscription by device token; a member without one gets no row.
  SELECT * INTO r FROM subscription_change_caller(tok, kl);
  IF r.subscription_id <> sub OR r.provider <> 'razorpay' OR r.provider_subscription_id <> 'sub_RZ1' OR r.plan <> 'plus-monthly' OR r.mode <> 'live' THEN
    RAISE EXCEPTION 'FAIL: caller lookup %', r;
  END IF;
  SELECT * INTO r FROM subscription_change_caller(tokf, kl);
  IF r.subscription_id IS NOT NULL THEN RAISE EXCEPTION 'FAIL: free member has a subscription row'; END IF;

  -- 2. A change scheduled for later keeps the current plan (and grant) until it is due …
  PERFORM subscription_set_pending_plan(sub, 'max5-monthly', now() + interval '20 days');
  IF subscription_effective_plan(sub) <> 'plus-monthly' THEN RAISE EXCEPTION 'FAIL: pending applied early'; END IF;
  IF (allowance_status(tok, kl, 'credits')->>'grant_per_month')::INT <> 100 THEN RAISE EXCEPTION 'FAIL: grant moved early'; END IF;
  SELECT * INTO r FROM subscription_change_caller(tok, kl);
  IF r.pending_plan <> 'max5-monthly' THEN RAISE EXCEPTION 'FAIL: caller does not see the pending plan'; END IF;

  -- 3. … and takes over once due, even if a renewal webhook rewrote `plan` with the old SKU.
  UPDATE subscriptions SET plan_changes_at = now() - interval '1 minute', plan = 'plus-monthly' WHERE id = sub;
  IF subscription_effective_plan(sub) <> 'max5-monthly' THEN RAISE EXCEPTION 'FAIL: pending not applied when due'; END IF;
  IF (allowance_status(tok, kl, 'credits')->>'grant_per_month')::INT <> 1500 THEN RAISE EXCEPTION 'FAIL: grant did not follow the new plan'; END IF;

  -- 4. An immediate change (Stripe) sets the plan and clears any pending one.
  PERFORM subscription_set_pending_plan(sub, 'plus-monthly', NULL);
  IF subscription_effective_plan(sub) <> 'plus-monthly' OR (SELECT pending_plan FROM subscriptions WHERE id = sub) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL: immediate change';
  END IF;

  -- 5. A scheduled change that has taken effect is folded into `plan` before the next one is scheduled.
  PERFORM subscription_set_pending_plan(sub, 'max5-monthly', now() + interval '20 days');
  UPDATE subscriptions SET plan_changes_at = now() - interval '1 minute' WHERE id = sub;   -- the max change is now live
  PERFORM subscription_set_pending_plan(sub, 'plus-monthly', now() + interval '30 days'); -- schedule a downgrade
  IF subscription_effective_plan(sub) <> 'max5-monthly' THEN RAISE EXCEPTION 'FAIL: applied change lost when scheduling the next (%)', subscription_effective_plan(sub); END IF;

  -- 5. Only the service role may record a change.
  IF has_function_privilege('anon', 'subscription_set_pending_plan(uuid, text, timestamptz)', 'EXECUTE') THEN
    RAISE EXCEPTION 'FAIL: anon can record a plan change';
  END IF;

  RAISE NOTICE 'PASS 197_subscription_plan_change';
END $$;
ROLLBACK;
