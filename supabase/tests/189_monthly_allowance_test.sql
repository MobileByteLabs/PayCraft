-- Assertions for migration 189 (monthly free allowance for a metered action, e.g. ReelExport "full edit").
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/189_monthly_allowance_test.sql
BEGIN;
DO $$
DECLARE
  t UUID; kl TEXT; s UUID; s2 UUID; r TEXT; st JSONB; ok BOOLEAN;
  tok CONSTANT TEXT := 'dev-token-189-aaaaaaaaaaaaaaaa';
  tok2 CONSTANT TEXT := 'dev-token-189-bbbbbbbbbbbbbbbb';
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('allowance-189','a189@test.local','pk_test_'||gen_random_uuid(),'pk_live_'||gen_random_uuid(),'w','w')
  RETURNING id, api_key_live INTO t, kl;
  INSERT INTO entitlement_subjects DEFAULT VALUES RETURNING id INTO s;
  INSERT INTO entitlement_subjects DEFAULT VALUES RETURNING id INTO s2;
  INSERT INTO registered_devices (email, device_token, platform, mode, is_active, tenant_id, subject_id)
  VALUES ('maker@x.test', tok, 'web', 'live', true, t, s), ('pro@x.test', tok2, 'web', 'live', true, t, s2);

  -- 0. No allowance configured for the sku → refused, never an error the caller must parse.
  IF allowance_spend(tok, kl, 'full-edit', 'k0') <> 'refused' THEN RAISE EXCEPTION 'FAIL: unconfigured sku must refuse'; END IF;

  PERFORM allowance_configure(t, 'full-edit', 5, ARRAY['edits-10']);

  -- 1. Five spends in a month succeed from the allowance; the sixth is refused.
  FOR i IN 1..5 LOOP
    r := allowance_spend(tok, kl, 'full-edit', 'k'||i);
    IF r <> 'allowance' THEN RAISE EXCEPTION 'FAIL: spend % returned %', i, r; END IF;
  END LOOP;
  IF allowance_spend(tok, kl, 'full-edit', 'k6') <> 'refused' THEN RAISE EXCEPTION 'FAIL: 6th spend must be refused'; END IF;
  st := allowance_status(tok, kl, 'full-edit');
  IF (st->>'used')::INT <> 5 OR (st->>'remaining')::INT <> 0 OR (st->>'free_per_month')::INT <> 5 THEN
    RAISE EXCEPTION 'FAIL: status after 5 spends: %', st; END IF;
  IF (st->>'resets_at')::timestamptz <> date_trunc('month', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC' + interval '1 month' THEN
    RAISE EXCEPTION 'FAIL: resets_at must be the 1st of next month UTC: %', st->>'resets_at'; END IF;

  -- 2. A repeated key is the same answer, never a second charge.
  IF allowance_spend(tok, kl, 'full-edit', 'k3') <> 'allowance' THEN RAISE EXCEPTION 'FAIL: replay must return the original source'; END IF;
  IF (SELECT count(*) FROM entitlement_allowance_spends WHERE tenant_id = t) <> 5 THEN RAISE EXCEPTION 'FAIL: replay inserted a row'; END IF;

  -- 3. A refund gives one edit back, once.
  IF allowance_refund(t, 'k2') IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: refund failed'; END IF;
  IF allowance_refund(t, 'k2') IS NOT FALSE THEN RAISE EXCEPTION 'FAIL: double refund allowed'; END IF;
  IF (allowance_status(tok, kl, 'full-edit')->>'remaining')::INT <> 1 THEN RAISE EXCEPTION 'FAIL: refund did not restore an edit'; END IF;
  IF allowance_spend(tok, kl, 'full-edit', 'k7') <> 'allowance' THEN RAISE EXCEPTION 'FAIL: refunded edit not reusable'; END IF;

  -- 4. A credit pack adds edits after the allowance runs out; its refund puts the credit back.
  INSERT INTO entitlement_balance_ledger (tenant_id, subject_id, sku, delta, reason, idempotency_key)
  VALUES (t, s, 'edits-10', 2, 'purchase', 'buy-1');
  IF allowance_spend(tok, kl, 'full-edit', 'k8') <> 'credit' THEN RAISE EXCEPTION 'FAIL: credit not used after allowance'; END IF;
  IF entitlement_balance_of_tenant(t, s, 'edits-10') <> 1 THEN RAISE EXCEPTION 'FAIL: credit not debited'; END IF;
  IF (allowance_status(tok, kl, 'full-edit')->>'credits')::INT <> 1 THEN RAISE EXCEPTION 'FAIL: status credits'; END IF;
  PERFORM allowance_refund(t, 'k8');
  IF entitlement_balance_of_tenant(t, s, 'edits-10') <> 2 THEN RAISE EXCEPTION 'FAIL: credit refund'; END IF;

  -- 5. Next calendar month resets the allowance (spends are counted per month).
  UPDATE entitlement_allowance_spends SET period = (date_trunc('month', now() AT TIME ZONE 'UTC') - interval '1 month')::date WHERE tenant_id = t;
  IF (allowance_status(tok, kl, 'full-edit')->>'used')::INT <> 0 THEN RAISE EXCEPTION 'FAIL: month did not reset'; END IF;
  IF allowance_spend(tok, kl, 'full-edit', 'k9') <> 'allowance' THEN RAISE EXCEPTION 'FAIL: new month spend'; END IF;

  -- 6. Pro bypasses the allowance and is recorded as such (not counted).
  INSERT INTO subscriptions (email, provider, plan, status, current_period_end, mode, tenant_id, subject_id)
  VALUES ('pro@x.test', 'stripe', 'monthly', 'active', now() + interval '20 days', 'live', t, s2);
  FOR i IN 1..7 LOOP
    IF allowance_spend(tok2, kl, 'full-edit', 'p'||i) <> 'pro' THEN RAISE EXCEPTION 'FAIL: pro spend %', i; END IF;
  END LOOP;
  IF (allowance_status(tok2, kl, 'full-edit')->>'is_pro')::BOOLEAN IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: is_pro'; END IF;
  IF (allowance_status(tok2, kl, 'full-edit')->>'used')::INT <> 0 THEN RAISE EXCEPTION 'FAIL: pro spends counted'; END IF;

  -- 7. Bad tokens and keys.
  BEGIN
    PERFORM allowance_spend('no-such-token-zzzzzzzzzz', kl, 'full-edit', 'x1');
    RAISE EXCEPTION 'FAIL: unknown token accepted';
  EXCEPTION WHEN invalid_authorization_specification THEN NULL; END;
  BEGIN
    PERFORM allowance_spend(tok, 'pk_live_nope', 'full-edit', 'x2');
    RAISE EXCEPTION 'FAIL: unknown key accepted';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM LIKE 'FAIL:%' THEN RAISE; END IF;   -- resolve_tenant: 'Invalid or inactive API key'
  END;

  -- 8. Refund is not callable by clients.
  IF has_function_privilege('anon', 'public.allowance_refund(uuid, text)', 'EXECUTE') THEN RAISE EXCEPTION 'FAIL: anon can refund'; END IF;
  IF NOT has_function_privilege('anon', 'public.allowance_spend(text, text, text, text)', 'EXECUTE') THEN RAISE EXCEPTION 'FAIL: anon cannot spend'; END IF;

  RAISE NOTICE 'PASS: 189 monthly allowance (configure, 5/month, replay, refund once, credit packs, month reset, pro, auth)';
END $$;
ROLLBACK;
