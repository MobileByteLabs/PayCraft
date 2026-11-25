-- Assertions for migration 213 (analytics from provider truth): provider country columns, entitlement first-seen
-- time, and paywall_funnel_stats — the funnel aggregated in SQL with "Paid" taken from what the providers
-- confirmed (entitlement_records for the stores, subscriptions for the web PSPs), never from app events.
--
--   supabase migration up --local
--   docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
--     < supabase/tests/213_analytics_provider_truth_test.sql
--
-- Each group RAISEs 'FAIL n: …' on the first broken expectation and prints 'ok n - …'. Runs in one transaction
-- and rolls back.
BEGIN;
DO $$
DECLARE
  t      UUID;
  other  UUID;
  since0 TIMESTAMPTZ := now() - interval '7 days';
  r      JSONB;
  n      INT;
  service CONSTANT TEXT := '{"role":"service_role"}';
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('t213', 'o213@x.test', 'pk_test_213a', 'pk_live_213a', 'whsec_t213a', 'whsec_l213a') RETURNING id INTO t;
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('o213', 'p213@x.test', 'pk_test_213b', 'pk_live_213b', 'whsec_t213b', 'whsec_l213b') RETURNING id INTO other;

  -- 1. columns exist
  SELECT count(*) INTO n FROM information_schema.columns
   WHERE (table_name, column_name) IN (('entitlement_records','country'), ('subscriptions','country'),
                                       ('entitlement_records','created_at'));
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL 1: expected 3 new columns, got %', n; END IF;
  RAISE NOTICE 'ok 1 - entitlement_records.country/created_at + subscriptions.country exist';

  -- Funnel seed (live): 4 viewers; b1 picks + checks out; b2 checks out WITHOUT a plan_select (default plan);
  -- b3 picks only; b4 views only. One test-mode event and one event older than the window must not count.
  INSERT INTO paywall_events (tenant_id, user_ref, device_ref, name, step, platform, sku, provider, country, mode, occurred_at)
  VALUES
    (t, 'b1', 'd1', 'paycraft_paywall_view',   'paywall',  'android', NULL, NULL, 'IN', 'live', now() - interval '1 day'),
    (t, 'b2', 'd2', 'paycraft_paywall_view',   'paywall',  'android', NULL, NULL, NULL, 'live', now() - interval '1 day'),
    (t, 'b3', 'd3', 'paycraft_paywall_view',   'paywall',  'android', NULL, NULL, 'US', 'live', now() - interval '1 day'),
    (t, NULL, 'd4', 'paycraft_paywall_view',   'paywall',  'android', NULL, NULL, NULL, 'live', now() - interval '1 day'),
    (t, 'b1', 'd1', 'paycraft_plan_select',    'plan',     'android', 'pro-monthly', NULL, 'IN', 'live', now() - interval '1 day'),
    (t, 'b1', 'd1', 'paycraft_checkout_start', 'checkout', 'android', 'pro-monthly', NULL, 'IN', 'live', now() - interval '1 day'),
    (t, 'b2', 'd2', 'paycraft_checkout_start', 'checkout', 'android', 'pro-annual',  NULL, NULL, 'live', now() - interval '1 day'),
    (t, 'b3', 'd3', 'paycraft_plan_select',    'plan',     'android', 'pro-annual',  NULL, 'US', 'live', now() - interval '1 day'),
    (t, 'b9', 'd9', 'paycraft_paywall_view',   'paywall',  'android', NULL, NULL, NULL, 'test', now() - interval '1 day'),
    (t, 'b8', 'd8', 'paycraft_paywall_view',   'paywall',  'android', NULL, NULL, NULL, 'live', now() - interval '30 days'),
    (other, 'z1', 'z1', 'paycraft_paywall_view', 'paywall', 'android', NULL, NULL, NULL, 'live', now() - interval '1 day');

  -- Provider truth: one live Play purchase (IN) and one live Stripe subscription (US) confirmed in the window;
  -- a sandbox Play purchase, an expired one and an old Stripe one must not count as Paid. No purchase_success
  -- app event exists at all — Paid must still be 2.
  INSERT INTO entitlement_records (app_user_id, tenant_id, provider, product_id, stable_txn_id, canonical_state,
                                   is_sandbox, latest_event_ts, country, created_at)
  VALUES ('u1', t, 'google_play', 'pro_monthly', 'gp-213-1', 'active',  false, now(), 'IN', now() - interval '1 day'),
         ('u2', t, 'google_play', 'pro_monthly', 'gp-213-2', 'active',  true,  now(), 'IN', now() - interval '1 day'),
         ('u3', t, 'google_play', 'pro_monthly', 'gp-213-3', 'expired', false, now(), 'IN', now() - interval '2 days');
  INSERT INTO subscriptions (email, provider, plan, status, mode, tenant_id, country, created_at)
  VALUES ('s1@x.test', 'stripe', 'pro-annual', 'active', 'live', t, 'US', now() - interval '1 day'),
         ('s2@x.test', 'stripe', 'pro-annual', 'active', 'live', t, 'US', now() - interval '40 days');

  PERFORM set_config('request.jwt.claims', service, true);
  r := public.paywall_funnel_stats(t, 'live', since0);

  -- 2. step counts: viewed 4, picked 3 (b1, b3 by plan_select; b2 by checkout), checkout 2, paid 2 (provider-confirmed)
  IF (r->>'viewed')::int <> 4 OR (r->>'picked')::int <> 3 OR (r->>'checkout')::int <> 2 OR (r->>'paid')::int <> 2 THEN
    RAISE EXCEPTION 'FAIL 2: got %', r;
  END IF;
  RAISE NOTICE 'ok 2 - viewed 4 · picked 3 (plan_select OR checkout_start) · checkout 2 · paid 2 from providers';

  -- 3. paid by provider from provider truth
  SELECT count(*) INTO n FROM jsonb_array_elements(r->'by_provider') e
   WHERE (e->>'key' = 'google_play' AND (e->>'paid')::int = 1) OR (e->>'key' = 'stripe' AND (e->>'paid')::int = 1);
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL 3: by_provider %', r->'by_provider'; END IF;
  RAISE NOTICE 'ok 3 - paid split by provider: google_play 1, stripe 1';

  -- 4. country: viewers from events (IN 1, US 1, unknown 2); paid from provider country (IN 1, US 1)
  SELECT count(*) INTO n FROM jsonb_array_elements(r->'by_country') e
   WHERE (e->>'key' = 'IN' AND (e->>'viewers')::int = 1 AND (e->>'paid')::int = 1)
      OR (e->>'key' = 'US' AND (e->>'viewers')::int = 1 AND (e->>'paid')::int = 1)
      OR (e->>'key' = 'unknown' AND (e->>'viewers')::int = 2);
  IF n <> 3 THEN RAISE EXCEPTION 'FAIL 4: by_country %', r->'by_country'; END IF;
  RAISE NOTICE 'ok 4 - country split: events for viewers, provider country for paid';

  -- 5. tenant isolation for an authenticated non-member
  PERFORM set_config('request.jwt.claims', json_build_object('role','authenticated','sub', gen_random_uuid())::text, true);
  BEGIN
    PERFORM public.paywall_funnel_stats(t, 'live', since0);
    RAISE EXCEPTION 'FAIL 5: non-member read another tenant''s funnel';
  EXCEPTION WHEN insufficient_privilege THEN
    RAISE NOTICE 'ok 5 - non-member refused (42501)';
  END;

  RAISE NOTICE 'PASS 213_analytics_provider_truth: 5/5 groups ok';
END $$;
ROLLBACK;
