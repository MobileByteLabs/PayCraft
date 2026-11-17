-- Assertions for migration 198 (allowance_status says which plan the caller is on, and any scheduled change).
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/198_allowance_status_plan_test.sql
BEGIN;
DO $$
DECLARE
  t UUID; kl TEXT; s UUID; sf UUID; sub UUID; st JSONB;
  tok  CONSTANT TEXT := 'dev-token-198-aaaaaaaaaaaaaaaa';
  tokf CONSTANT TEXT := 'dev-token-198-ffffffffffffffff';
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('status-198','s198@test.local','pk_test_'||gen_random_uuid(),'pk_live_'||gen_random_uuid(),'w','w')
  RETURNING id, api_key_live INTO t, kl;
  INSERT INTO entitlement_subjects DEFAULT VALUES RETURNING id INTO s;
  INSERT INTO entitlement_subjects DEFAULT VALUES RETURNING id INTO sf;
  INSERT INTO registered_devices (email, device_token, platform, mode, is_active, tenant_id, subject_id)
  VALUES ('plus@x.test', tok, 'web', 'live', true, t, s), ('free@x.test', tokf, 'web', 'live', true, t, sf);
  INSERT INTO subscriptions (email, provider, provider_subscription_id, plan, status, current_period_end, mode, tenant_id, subject_id)
  VALUES ('plus@x.test', 'razorpay', 'sub_1', 'plus-monthly', 'active', now() + interval '20 days', 'live', t, s) RETURNING id INTO sub;
  PERFORM allowance_configure(t, 'credits', 0, ARRAY['credits'], 300);

  st := allowance_status(tok, kl, 'credits');
  IF st->>'plan' <> 'plus-monthly' OR st->'pending_plan' <> 'null'::jsonb THEN RAISE EXCEPTION 'FAIL: plan %', st; END IF;
  PERFORM subscription_set_pending_plan(sub, 'max5-monthly', now() + interval '20 days');
  st := allowance_status(tok, kl, 'credits');
  IF st->>'plan' <> 'plus-monthly' OR st->>'pending_plan' <> 'max5-monthly' OR st->>'plan_changes_at' IS NULL THEN RAISE EXCEPTION 'FAIL: pending %', st; END IF;
  st := allowance_status(tokf, kl, 'credits');
  IF st->'plan' <> 'null'::jsonb THEN RAISE EXCEPTION 'FAIL: free member has a plan %', st; END IF;
  RAISE NOTICE 'PASS 198_allowance_status_plan';
END $$;
ROLLBACK;
