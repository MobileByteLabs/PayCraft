-- 143_readiness_manual_steps.sql
--
-- Return the manual work as STEPS, not a paragraph.
--
-- Play and App Store test readiness cannot be asserted through an API — there is no "enable test
-- mode" call, and no way to ask either store whether a tester is configured. The row turns green
-- only when a real sandbox purchase reaches PayCraft. That makes the instructions the ONLY thing
-- the product can offer, so they need to be followable.
--
-- `human_action` already carried them, but as one dense sentence-run rendered into a single amber
-- paragraph: correct, and hard to execute. This adds `manual_steps` (an ordered JSONB array) and
-- `console_url` (where the work happens) alongside it.
--
-- `human_action` is KEPT and unchanged. It is consumed elsewhere (/idea-paycraft, drift action
-- hints), and replacing it would have made this a breaking change to a contract that has other
-- readers — for a formatting improvement. The steps are additive; the paragraph remains the
-- one-line summary.
--
-- The steps live HERE rather than in the dashboard component for the same reason the paragraph
-- does: one source of truth. Restating them in React would let the UI and the CLI tell a developer
-- two different things about the same gap.

-- The return type gains columns, so the function must be dropped rather than replaced.
DROP FUNCTION IF EXISTS public.tenant_providers_mode_readiness(UUID);

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
  human_action    TEXT,
  manual_steps    JSONB,
  console_url     TEXT
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
    SELECT
      COUNT(*) FILTER (
        WHERE tpr.razorpay_plan_id_by_currency IS NOT NULL
          AND tpr.razorpay_plan_id_by_currency <> '{}'::jsonb
          AND tpr.live_plan_ids_verified          -- unverified legacy ids prove nothing
      ) AS live_plans,
      COUNT(*) FILTER (
        WHERE tpr.razorpay_plan_id_by_currency_test IS NOT NULL
          AND tpr.razorpay_plan_id_by_currency_test <> '{}'::jsonb
      ) AS test_plans,
      COUNT(*) FILTER (
        WHERE tpr.razorpay_plan_id_by_currency IS NOT NULL
          AND tpr.razorpay_plan_id_by_currency <> '{}'::jsonb
          AND NOT tpr.live_plan_ids_verified
      ) AS unverified_plans
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
           AND (COALESCE(lc.live_links, 0) > 0 OR COALESCE(pl.live_plans, 0) > 0)
    END,
    CASE
      WHEN tp.provider IN (SELECT p FROM store_kinds) THEN COALESCE(ss.n, 0) > 0
      ELSE k.test_key IS NOT NULL
           AND (COALESCE(lc.test_links, 0) > 0 OR COALESCE(pl.test_plans, 0) > 0)
    END,
    CASE
      WHEN tp.provider IN (SELECT p FROM store_kinds) THEN
        CASE WHEN tp.store_credential_enc IS NOT NULL OR tp.provider_account_id IS NOT NULL
             THEN 'store credential attached' ELSE 'no store credential' END
      WHEN k.live_key IS NULL AND tp.provider_account_id IS NULL THEN 'no live credential'
      WHEN COALESCE(lc.live_links, 0) = 0 AND COALESCE(pl.live_plans, 0) > 0 THEN
        'live credential present; ' || pl.live_plans::TEXT ||
        ' live subscription plan(s) (Razorpay subscriptions are plans, not links)'
      WHEN COALESCE(lc.live_links, 0) = 0 AND COALESCE(pl.unverified_plans, 0) > 0 THEN
        'live credential present, but ' || pl.unverified_plans::TEXT || ' plan id(s) predate the ' ||
        'mode split (migration 141) and may have been written by a TEST sync — run product sync to ' ||
        'rewrite them from the live account'
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
      WHEN COALESCE(lc.test_links, 0) = 0 AND COALESCE(pl.test_plans, 0) > 0 THEN
        'test key ' || f.test_fp || ', ' || pl.test_plans::TEXT ||
        ' test subscription plan(s) (Razorpay subscriptions are plans, not links)'
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
    END,
    -- Ordered, executable steps for the work that has no API. NULL when the row is already green.
    CASE
      WHEN tp.provider = 'google_play' AND COALESCE(ss.n, 0) = 0 THEN jsonb_build_array(
        'Play Console → your app → Setup → License testing',
        'Add the tester''s Google account under "License testers" and save',
        'Testing → Internal testing → Testers: make sure that same account is on the track',
        'On the device, sign in to Google Play with that account (Play Store → profile → switch account)',
        'Install the app FROM THE PLAY TRACK — license testing only applies to Play-delivered builds, not a sideloaded APK',
        'Open the paywall and buy. A license tester is charged nothing and the purchase is flagged as a test',
        'This row turns green automatically when that purchase reaches PayCraft'
      )
      WHEN tp.provider = 'app_store' AND COALESCE(ss.n, 0) = 0 THEN jsonb_build_array(
        'App Store Connect → Users and Access → Sandbox → Test Accounts → (+)',
        'Create a sandbox Apple ID. Use an email that is NOT already an Apple ID',
        'On the device: Settings → App Store → scroll to SANDBOX ACCOUNT → sign in with it',
        'Do NOT sign out of your real Apple ID — the sandbox slot is separate and signing out is not required',
        'Install a development or TestFlight build (a build from the App Store uses production StoreKit)',
        'Open the paywall and buy. Product ids are the same; Apple routes verification to the sandbox host',
        'This row turns green automatically when that purchase reaches PayCraft'
      )
      WHEN tp.provider NOT IN (SELECT p FROM store_kinds) AND k.test_key IS NULL THEN jsonb_build_array(
        'Open the ' || tp.provider || ' dashboard and switch it to TEST mode',
        'Copy the test API key pair (and the test webhook secret, if that provider signs webhooks)',
        'PayCraft → Providers → ' || tp.provider || ' → paste them into the TEST fields and save',
        'The credential is account-level, so every app sharing this connection gets it',
        'Run product sync — it writes every configured mode, creating the test products automatically'
      )
      WHEN tp.provider NOT IN (SELECT p FROM store_kinds)
           AND k.test_key IS NOT NULL
           AND COALESCE(lc.test_links, 0) = 0
           AND COALESCE(pl.test_plans, 0) = 0 THEN jsonb_build_array(
        'The test credential is already attached — only the products are missing',
        'Run product sync: POST /v1/sync (management API) or Products → Sync in the dashboard',
        'Re-check this row; it turns green as soon as the test artifacts exist'
      )
      ELSE NULL
    END,
    CASE tp.provider
      WHEN 'google_play' THEN 'https://play.google.com/console'
      WHEN 'app_store'   THEN 'https://appstoreconnect.apple.com/access/users/sandbox'
      WHEN 'stripe'      THEN 'https://dashboard.stripe.com/test/apikeys'
      WHEN 'razorpay'    THEN 'https://dashboard.razorpay.com/app/website-app-settings/api-keys'
      WHEN 'cashfree'    THEN 'https://merchant.cashfree.com/merchants/pg/developers'
      ELSE NULL
    END
  FROM public.tenant_providers tp
  LEFT JOIN link_counts  lc ON lc.p = tp.provider
  LEFT JOIN sandbox_seen ss ON ss.p = tp.provider
  LEFT JOIN keys         k  ON k.p  = tp.provider
  LEFT JOIN fp           f  ON f.p  = tp.provider
  -- Plans are per-tenant, not per-provider; only Razorpay uses them, so gate on the provider name.
  LEFT JOIN LATERAL (
    SELECT
      CASE WHEN tp.provider = 'razorpay' THEN (SELECT live_plans       FROM plan_counts) ELSE 0 END AS live_plans,
      CASE WHEN tp.provider = 'razorpay' THEN (SELECT test_plans       FROM plan_counts) ELSE 0 END AS test_plans,
      CASE WHEN tp.provider = 'razorpay' THEN (SELECT unverified_plans FROM plan_counts) ELSE 0 END AS unverified_plans
  ) pl ON TRUE
  WHERE tp.tenant_id = p_tenant_id
  ORDER BY tp.provider;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_providers_mode_readiness(UUID) TO authenticated, service_role;
