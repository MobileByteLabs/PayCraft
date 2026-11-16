-- Assertions for migration 195 (metered UNITS + a Pro monthly grant on the 189 allowance — ReelExport credits).
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 < supabase/tests/195_allowance_units_test.sql
BEGIN;
DO $$
DECLARE
  t UUID; kl TEXT; s UUID; s2 UUID; j JSONB; st JSONB;
  tok  CONSTANT TEXT := 'dev-token-195-aaaaaaaaaaaaaaaa';
  tok2 CONSTANT TEXT := 'dev-token-195-bbbbbbbbbbbbbbbb';
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('allowance-195','a195@test.local','pk_test_'||gen_random_uuid(),'pk_live_'||gen_random_uuid(),'w','w')
  RETURNING id, api_key_live INTO t, kl;
  INSERT INTO entitlement_subjects DEFAULT VALUES RETURNING id INTO s;
  INSERT INTO entitlement_subjects DEFAULT VALUES RETURNING id INTO s2;
  INSERT INTO registered_devices (email, device_token, platform, mode, is_active, tenant_id, subject_id)
  VALUES ('free@x.test', tok, 'web', 'live', true, t, s), ('pro@x.test', tok2, 'web', 'live', true, t, s2);
  INSERT INTO subscriptions (email, provider, plan, status, current_period_end, mode, tenant_id, subject_id)
  VALUES ('pro@x.test', 'stripe', 'monthly', 'active', now() + interval '20 days', 'live', t, s2);

  -- Credits: free members get none, Pro gets 300 a month, packs top up (sku 'credits').
  PERFORM allowance_configure(t, 'credits', 0, ARRAY['credits'], 300);

  -- 1. Pro spends units from the monthly grant.
  j := allowance_spend_units(tok2, kl, 'credits', 100, 'c1');
  IF j->>'source' <> 'pro' OR (j->>'period_units')::INT <> 100 OR (j->>'credit_units')::INT <> 0 THEN RAISE EXCEPTION 'FAIL: pro grant spend %', j; END IF;
  st := allowance_status(tok2, kl, 'credits');
  IF (st->>'grant_per_month')::INT <> 300 OR (st->>'grant_used')::INT <> 100 OR (st->>'grant_remaining')::INT <> 200 THEN RAISE EXCEPTION 'FAIL: pro status %', st; END IF;

  -- 2. Past the grant, the rest comes from the pack balance in the same spend; nothing partial when short.
  INSERT INTO entitlement_balance_ledger (tenant_id, subject_id, sku, delta, reason, idempotency_key) VALUES (t, s2, 'credits', 150, 'purchase', 'buy-195');
  j := allowance_spend_units(tok2, kl, 'credits', 250, 'c2');   -- 200 from grant + 50 from pack
  IF j->>'source' <> 'credit' OR (j->>'period_units')::INT <> 200 OR (j->>'credit_units')::INT <> 50 THEN RAISE EXCEPTION 'FAIL: split spend %', j; END IF;
  IF entitlement_balance_of_tenant(t, s2, 'credits') <> 100 THEN RAISE EXCEPTION 'FAIL: pack not debited by 50'; END IF;
  j := allowance_spend_units(tok2, kl, 'credits', 101, 'c3');
  IF j->>'source' <> 'refused' THEN RAISE EXCEPTION 'FAIL: short spend must refuse %', j; END IF;
  IF entitlement_balance_of_tenant(t, s2, 'credits') <> 100 THEN RAISE EXCEPTION 'FAIL: refused spend moved the balance'; END IF;

  -- 3. Replay returns the original answer and charges nothing.
  IF allowance_spend_units(tok2, kl, 'credits', 250, 'c2')->>'credit_units' <> '50' THEN RAISE EXCEPTION 'FAIL: replay'; END IF;
  IF entitlement_balance_of_tenant(t, s2, 'credits') <> 100 THEN RAISE EXCEPTION 'FAIL: replay charged'; END IF;

  -- 4. Refund gives back both parts, once.
  IF allowance_refund(t, 'c2') IS NOT TRUE THEN RAISE EXCEPTION 'FAIL: refund'; END IF;
  IF allowance_refund(t, 'c2') IS NOT FALSE THEN RAISE EXCEPTION 'FAIL: double refund'; END IF;
  IF entitlement_balance_of_tenant(t, s2, 'credits') <> 150 THEN RAISE EXCEPTION 'FAIL: pack part not refunded'; END IF;
  IF (allowance_status(tok2, kl, 'credits')->>'grant_remaining')::INT <> 200 THEN RAISE EXCEPTION 'FAIL: grant part not refunded'; END IF;

  -- 5. The grant resets each calendar month; unused grant does not roll over, packs stay.
  UPDATE entitlement_allowance_spends SET period = (date_trunc('month', now() AT TIME ZONE 'UTC') - interval '1 month')::date WHERE tenant_id = t;
  IF (allowance_status(tok2, kl, 'credits')->>'grant_remaining')::INT <> 300 THEN RAISE EXCEPTION 'FAIL: grant did not reset'; END IF;

  -- 6. A free member has no grant; only a pack pays.
  IF allowance_spend_units(tok, kl, 'credits', 10, 'f1')->>'source' <> 'refused' THEN RAISE EXCEPTION 'FAIL: free member spent without credits'; END IF;
  INSERT INTO entitlement_balance_ledger (tenant_id, subject_id, sku, delta, reason, idempotency_key) VALUES (t, s, 'credits', 20, 'purchase', 'buy-195-f');
  IF allowance_spend_units(tok, kl, 'credits', 10, 'f2')->>'source' <> 'credit' THEN RAISE EXCEPTION 'FAIL: free member pack spend'; END IF;

  -- 7. Quantity must be positive.
  BEGIN
    PERFORM allowance_spend_units(tok2, kl, 'credits', 0, 'z0');
    RAISE EXCEPTION 'FAIL: zero quantity accepted';
  EXCEPTION WHEN check_violation THEN NULL; END;

  -- 8. Unchanged 189 behaviour: pro_per_month NULL keeps Pro unmetered; the 4-arg spend still answers in text.
  PERFORM allowance_configure(t, 'full-edit', 5, ARRAY['edits-10']);
  IF allowance_spend(tok2, kl, 'full-edit', 'e1') <> 'pro' THEN RAISE EXCEPTION 'FAIL: legacy pro'; END IF;
  IF allowance_spend(tok, kl, 'full-edit', 'e2') <> 'allowance' THEN RAISE EXCEPTION 'FAIL: legacy allowance'; END IF;
  IF (allowance_status(tok, kl, 'full-edit')->>'used')::INT <> 1 THEN RAISE EXCEPTION 'FAIL: legacy used count'; END IF;

  IF NOT has_function_privilege('anon', 'public.allowance_spend_units(text, text, text, integer, text)', 'EXECUTE') THEN RAISE EXCEPTION 'FAIL: anon cannot spend units'; END IF;

  RAISE NOTICE 'PASS: 195 allowance units (pro grant, split with pack, refuse short, replay, refund both parts, monthly reset, free, legacy)';
END $$;
ROLLBACK;
