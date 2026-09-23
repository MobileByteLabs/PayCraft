-- 140_readiness_razorpay_plans.sql
--
-- Stop telling the operator to "run product sync" for a provider whose sync already SUCCEEDED.
--
-- Razorpay turns a subscription into a PLAN, not a payment link — `razorpay_plan_id_by_currency` on
-- tenant_products, with `test_payment_links` / `live_payment_links` left as `{sku: {}}`. 135 judged
-- readiness purely on link counts, so after a sync that created three real plans
-- (plan_TfNY…, plan_TfNZ…) Razorpay still read `test_ready = false` with the advice "0 test payment
-- links — run product sync". Following that advice re-runs a sync that will succeed again and change
-- nothing. `detectActiveProviderZeroLinks` has always known this (its `hasArtifact` checks the plan
-- map); readiness did not.
--
-- A SECOND, LARGER PROBLEM THIS SURFACES — AND DELIBERATELY DOES NOT HIDE
-- `razorpay_plan_id_by_currency` is a SINGLE column. It is not mode-scoped, so a test-mode sync and
-- a live-mode sync write the same field and the last one wins. That means:
--   • readiness cannot prove WHICH mode an existing plan belongs to, and
--   • a test sync can leave the live app pointing at a TEST plan id.
-- So this migration reports plans as present-but-unattributable rather than inventing a green
-- verdict from an ambiguous field. Making Razorpay show `test_ready = true` here would be a
-- guess dressed as a fact, and the fix for that is a schema change (mode-scoped plan ids), not a
-- more generous CASE expression.

CREATE OR REPLACE FUNCTION public.tenant_providers_mode_readiness(p_tenant_id UUID)
RETURNS TABLE (
  provider        TEXT,
  auth_kind       TEXT,
  is_active       BOOLEAN,
  live_ready      BOOLEAN,
  test_ready      BOOLEAN,
  live_detail     TEXT,
  test_detail     TEXT,
  test_mechanism  TEXT,
  human_action    TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH store_kinds AS (
    SELECT unnest(ARRAY['google_play', 'app_store']) AS p
  ),
  sandbox_seen AS (
    SELECT er.provider AS p, COUNT(*) AS n, MAX(er.updated_at) AS last_seen
    FROM public.entitlement_records er
    WHERE er.tenant_id = p_tenant_id AND er.is_sandbox = TRUE
    GROUP BY er.provider
  ),
  link_counts AS (
    SELECT
      tp.provider AS p,
      (SELECT COALESCE(SUM(jsonb_array_length(jsonb_path_query_array(v, '$.*'))), 0)
         FROM jsonb_each(COALESCE(tp.test_payment_links, '{}'::jsonb)) AS t(k, v)) AS test_links,
      (SELECT COALESCE(SUM(jsonb_array_length(jsonb_path_query_array(v, '$.*'))), 0)
         FROM jsonb_each(COALESCE(tp.live_payment_links, '{}'::jsonb)) AS t(k, v)) AS live_links
    FROM public.tenant_providers tp
    WHERE tp.tenant_id = p_tenant_id
  ),
  -- THE CHANGE: key ids come from the shared account. COALESCE keeps any pre-112 row that still
  -- carries its own value working, so this is strictly additive — no app loses a verdict it had.
  keys AS (
    SELECT
      tp.provider AS p,
      COALESCE(pa.config->>'live_key_id', tp.live_key_id) AS live_key,
      COALESCE(pa.config->>'test_key_id', tp.test_key_id) AS test_key
    FROM public.tenant_providers tp
    LEFT JOIN public.provider_accounts pa ON pa.id = tp.provider_account_id
    WHERE tp.tenant_id = p_tenant_id
  ),
  -- Subscription plans are Razorpay's synced artifact; counting only links misses them entirely.
  plan_counts AS (
    SELECT COUNT(*) FILTER (
             WHERE tpr.razorpay_plan_id_by_currency IS NOT NULL
               AND tpr.razorpay_plan_id_by_currency <> '{}'::jsonb
           ) AS plans
    FROM public.tenant_products tpr
    WHERE tpr.tenant_id = p_tenant_id
  ),
  fp AS (
    SELECT
      k.p,
      CASE WHEN k.live_key IS NULL THEN NULL
           ELSE left(k.live_key, 11) || '…' || right(k.live_key, 4) END AS live_fp,
      CASE WHEN k.test_key IS NULL THEN NULL
           ELSE left(k.test_key, 11) || '…' || right(k.test_key, 4) END AS test_fp
    FROM keys k
  )
  SELECT
    tp.provider,
    CASE WHEN tp.provider IN (SELECT p FROM store_kinds) THEN 'store' ELSE 'key_pair' END,
    tp.is_active,
    CASE
      WHEN tp.provider IN (SELECT p FROM store_kinds)
        THEN tp.store_credential_enc IS NOT NULL OR tp.provider_account_id IS NOT NULL
      ELSE (k.live_key IS NOT NULL OR tp.provider_account_id IS NOT NULL)
           AND (COALESCE(lc.live_links, 0) > 0 OR COALESCE(pl.plans, 0) > 0)
    END,
    CASE
      WHEN tp.provider IN (SELECT p FROM store_kinds) THEN COALESCE(ss.n, 0) > 0
      ELSE k.test_key IS NOT NULL AND COALESCE(lc.test_links, 0) > 0
    END,
    CASE
      WHEN tp.provider IN (SELECT p FROM store_kinds) THEN
        CASE WHEN tp.store_credential_enc IS NOT NULL OR tp.provider_account_id IS NOT NULL
             THEN 'store credential attached' ELSE 'no store credential' END
      WHEN k.live_key IS NULL AND tp.provider_account_id IS NULL THEN 'no live credential'
      WHEN COALESCE(lc.live_links, 0) = 0 AND COALESCE(pl.plans, 0) > 0 THEN
        'live credential present; ' || pl.plans::TEXT || ' subscription plan(s) exist (Razorpay ' ||
        'subscriptions are plans, not links)'
      WHEN COALESCE(lc.live_links, 0) = 0 THEN 'live credential present but 0 payment links — run product sync'
      ELSE 'live key ' || COALESCE(f.live_fp, '(via account)') ||
           ', ' || COALESCE(lc.live_links, 0)::TEXT || ' payment link(s)'
    END,
    CASE
      WHEN tp.provider IN (SELECT p FROM store_kinds) THEN
        CASE WHEN COALESCE(ss.n, 0) > 0
             THEN 'proven — ' || ss.n::TEXT || ' sandbox entitlement(s), last ' ||
                  COALESCE(to_char(ss.last_seen, 'YYYY-MM-DD'), '?')
             ELSE 'not yet proven — no sandbox purchase has reached PayCraft for this provider' END
      WHEN k.test_key IS NULL THEN
        'no test credential on the shared account — sync can only create LIVE products, so a test build has no link to open'
      WHEN COALESCE(lc.test_links, 0) = 0 AND COALESCE(pl.plans, 0) > 0 THEN
        'test key ' || f.test_fp || ' on the shared account; ' || pl.plans::TEXT ||
        ' subscription plan(s) exist, but razorpay_plan_id_by_currency is NOT mode-scoped, so ' ||
        'PayCraft cannot tell whether they are test or live plans. Sync has run and succeeded — ' ||
        'proving test mode needs mode-scoped plan ids.'
      WHEN COALESCE(lc.test_links, 0) = 0 THEN
        'test key ' || f.test_fp || ' on the shared account, but 0 test payment links — run product sync'
      ELSE 'test key ' || f.test_fp || ', ' || COALESCE(lc.test_links, 0)::TEXT || ' payment link(s)'
    END,
    CASE tp.provider
      WHEN 'google_play' THEN 'license_tester'
      WHEN 'app_store'   THEN 'sandbox_apple_id'
      ELSE 'test_api_key'
    END,
    CASE
      WHEN tp.provider = 'google_play' AND COALESCE(ss.n, 0) = 0 THEN
        'Play Console → Setup → License testing: add a tester Google account. Real products then ' ||
        'cost that account nothing. There is no test product and no API to verify this — the row ' ||
        'turns green when the first sandbox purchase reaches PayCraft.'
      WHEN tp.provider = 'app_store' AND COALESCE(ss.n, 0) = 0 THEN
        'App Store Connect → Users and Access → Sandbox → Testers: create a sandbox Apple ID, then ' ||
        'sign into it on the device (Settings → App Store → Sandbox Account). Same product ids; ' ||
        'Apple routes verification to the sandbox host. Turns green on the first sandbox purchase.'
      WHEN tp.provider NOT IN (SELECT p FROM store_kinds) AND k.test_key IS NULL THEN
        'Add a ' || tp.provider || ' TEST-mode key to the shared connection in Providers → ' ||
        tp.provider || ', then run product sync. The credential is account-level — every app on ' ||
        'that connection gets it.'
      WHEN tp.provider NOT IN (SELECT p FROM store_kinds)
           AND k.test_key IS NOT NULL AND COALESCE(lc.test_links, 0) = 0 THEN
        'Run product sync (POST /api/sync/all) — the account has a test key but this app has no test links yet.'
      ELSE NULL
    END
  FROM public.tenant_providers tp
  LEFT JOIN link_counts  lc ON lc.p = tp.provider
  LEFT JOIN sandbox_seen ss ON ss.p = tp.provider
  LEFT JOIN keys         k  ON k.p  = tp.provider
  LEFT JOIN fp           f  ON f.p  = tp.provider
  -- Plans are per-tenant, not per-provider; only Razorpay uses them, so gate on the provider name.
  LEFT JOIN LATERAL (
    SELECT CASE WHEN tp.provider = 'razorpay' THEN (SELECT plans FROM plan_counts) ELSE 0 END AS plans
  ) pl ON TRUE
  WHERE tp.tenant_id = p_tenant_id
  ORDER BY tp.provider;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_providers_mode_readiness(UUID) TO authenticated, service_role;
