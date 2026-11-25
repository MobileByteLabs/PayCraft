-- Assertions for migration 214: a store failure reported by an SDK older than attempt tracking (record_store_attempt,
-- 188 + 201's reason) carries the same stage / error_class / error_code the current SDK sends, so Payment health
-- can say WHY it failed. On 2026-11-25 Reels Downloader showed 89 failed attempts with no cause while 69 of them
-- carried failure_reason 'product_not_found'.
--
--   supabase migration up --local
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/214_legacy_store_failure_test.sql
BEGIN;
DO $$
DECLARE
  t   UUID;
  r   RECORD;
  n   INT;
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('t214', 'o214@x.test', 'pk_test_214a', 'pk_live_214a', 'whsec_t214a', 'whsec_l214a') RETURNING id INTO t;

  -- 1. the class mirror matches the SDK's classifyStoreCode
  IF public.paycraft_store_failure_class('product_not_found') <> 'catalog'
     OR public.paycraft_store_failure_class('no_offer') <> 'catalog'
     OR public.paycraft_store_failure_class('query_2') <> 'store_query'
     OR public.paycraft_store_failure_class('connect_6') <> 'store_connect'
     OR public.paycraft_store_failure_class('purchase_3') <> 'store_purchase'
     OR public.paycraft_store_failure_class('launch_7') <> 'store_launch'
     OR public.paycraft_store_failure_class('timeout') <> 'timeout'
     OR public.paycraft_store_failure_class('no_activity') <> 'sdk_state'
     OR public.paycraft_store_failure_class('weird') <> 'store_other' THEN
    RAISE EXCEPTION 'FAIL 1: class mirror drifted from classifyStoreCode';
  END IF;
  RAISE NOTICE 'ok 1 - paycraft_store_failure_class mirrors the SDK';

  -- 2. the legacy write path: insert (outcome only), then 201's UPDATE adds the reason
  INSERT INTO checkout_attempts (app_user_id, tenant_id, provider, mode, plan, outcome, provider_session_id, occurred_at)
  VALUES ('u214', t, 'google_play', 'live', 'pro_quarterly', 'payment_failed', 'legacy-214-1', now());
  UPDATE checkout_attempts SET failure_reason = 'product_not_found' WHERE provider_session_id = 'legacy-214-1';
  SELECT state, stage, error_class, error_code INTO r FROM checkout_attempts WHERE provider_session_id = 'legacy-214-1';
  IF r.state <> 'failed' OR r.stage <> 'provider' OR r.error_class <> 'catalog' OR r.error_code <> 'product_not_found' THEN
    RAISE EXCEPTION 'FAIL 2: got % / % / % / %', r.state, r.stage, r.error_class, r.error_code;
  END IF;
  RAISE NOTICE 'ok 2 - a legacy failure gets stage provider, class catalog, code product_not_found';

  -- 3. a failure the current SDK already labelled is never overwritten
  INSERT INTO checkout_attempts (app_user_id, tenant_id, provider, mode, plan, outcome, provider_session_id, occurred_at,
                                 stage, error_class, error_code)
  VALUES ('u214', t, 'google_play', 'live', 'pro_monthly', 'payment_failed', 'legacy-214-2', now(), 'sdk', 'sdk_state', 'no_activity');
  UPDATE checkout_attempts SET failure_reason = 'purchase_3' WHERE provider_session_id = 'legacy-214-2';
  SELECT stage, error_class, error_code INTO r FROM checkout_attempts WHERE provider_session_id = 'legacy-214-2';
  IF r.stage <> 'sdk' OR r.error_code <> 'no_activity' THEN
    RAISE EXCEPTION 'FAIL 3: labelled failure overwritten: % / %', r.stage, r.error_code;
  END IF;
  RAISE NOTICE 'ok 3 - an SDK-labelled failure keeps its own stage and code';

  -- 4. an abandon is not a failure: no stage invented
  INSERT INTO checkout_attempts (app_user_id, tenant_id, provider, mode, plan, outcome, provider_session_id, occurred_at)
  VALUES ('u214', t, 'google_play', 'live', 'pro_monthly', 'abandoned', 'legacy-214-3', now());
  UPDATE checkout_attempts SET failure_reason = 'purchase_1' WHERE provider_session_id = 'legacy-214-3';
  SELECT count(*) INTO n FROM checkout_attempts WHERE provider_session_id = 'legacy-214-3' AND stage IS NULL;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL 4: abandon got a failure stage'; END IF;
  RAISE NOTICE 'ok 4 - abandons stay unlabelled';

  -- 5. backfill: rows written before 214 are labelled by the migration's own backfill function
  ALTER TABLE checkout_attempts DISABLE TRIGGER checkout_attempts_legacy_failure;
  INSERT INTO checkout_attempts (app_user_id, tenant_id, provider, mode, plan, outcome, provider_session_id, occurred_at, failure_reason)
  VALUES ('u214', t, 'google_play', 'live', 'pro_quarterly', 'payment_failed', 'legacy-214-4', now(), 'query_2');
  ALTER TABLE checkout_attempts ENABLE TRIGGER checkout_attempts_legacy_failure;
  PERFORM public.paycraft_label_legacy_store_failures();
  SELECT stage, error_class, error_code INTO r FROM checkout_attempts WHERE provider_session_id = 'legacy-214-4';
  IF r.stage <> 'provider' OR r.error_class <> 'store_query' OR r.error_code <> 'query_2' THEN
    RAISE EXCEPTION 'FAIL 5: backfill got % / % / %', r.stage, r.error_class, r.error_code;
  END IF;
  RAISE NOTICE 'ok 5 - backfill labels existing legacy failures';

  RAISE NOTICE 'PASS 214_legacy_store_failure: 5/5 groups ok';
END $$;
ROLLBACK;
