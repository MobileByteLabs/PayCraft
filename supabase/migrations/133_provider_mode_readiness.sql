-- 133_provider_mode_readiness.sql
--
-- Per-provider, PER-MODE readiness. `tenant_providers_resolved_list` (110/115) answers one
-- question — "does this provider bill at all?" — with a single `connected` boolean. That cannot
-- express the state the dashboard actually needs, because a provider can be perfectly connected for
-- LIVE and have no way to transact a TEST purchase at all. Measured on tenant cappy 2026-09-22,
-- straight out of `/config`:
--
--     "test_payment_links": {},
--     "live_payment_links": { "cappy_plus_annual": { "USD": "https://buy.stripe.com/…" }, … }
--
-- The old RPC reports that provider as `connected=true`, which is true and useless: a debug build
-- resolves the empty map and the checkout button does nothing.
--
-- ── TWO KINDS OF PROVIDER, AND THEY TEST DIFFERENTLY ─────────────────────────────────────────────
-- This is the distinction the whole function exists to encode, because getting it wrong produces a
-- finding no action can clear:
--
--   key_pair  (stripe, razorpay, cashfree, paddle, …)
--       Real test mode: a SEPARATE test credential, separate products, separate payment links.
--       Test readiness is therefore a FACT WE HOLD — does the test key exist, are there test links?
--
--   store     (google_play, app_store)
--       There is NO test product and no test credential. Both stores use the SAME product ids; what
--       changes is the ACCOUNT and environment — a Play license tester, or a sandbox Apple ID. Those
--       live in the Play Console / App Store Connect and have NO API to enumerate them. So test
--       readiness cannot be a credential check, and must not be a checkbox either: a merchant
--       ticking "I added a license tester" asserts nothing a later reader can trust.
--
--       Instead it is EVIDENCE: has a sandbox entitlement ever landed for this tenant+provider?
--       `entitlement_records.is_sandbox` is written from the store's own signal — Apple's
--       `environment == "Sandbox"`, Google's `testPurchase` presence — so a true value means a test
--       purchase demonstrably completed end to end. Before that it is honestly "not yet proven",
--       never "missing".
--
-- Idempotent per CLAUDE.md migration policy.

CREATE OR REPLACE FUNCTION public.tenant_providers_mode_readiness(p_tenant_id UUID)
RETURNS TABLE (
  provider        TEXT,
  auth_kind       TEXT,     -- 'key_pair' | 'store'
  is_active       BOOLEAN,
  live_ready      BOOLEAN,
  test_ready      BOOLEAN,
  live_detail     TEXT,
  test_detail     TEXT,
  test_mechanism  TEXT,     -- how test mode is achieved for THIS provider
  human_action    TEXT      -- NULL when nothing is outstanding
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
  -- Evidence that test mode WORKS for a store provider: a sandbox entitlement that actually landed.
  sandbox_seen AS (
    SELECT er.provider AS p, COUNT(*) AS n, MAX(er.updated_at) AS last_seen
    FROM public.entitlement_records er
    WHERE er.tenant_id = p_tenant_id
      AND er.is_sandbox = TRUE
    GROUP BY er.provider
  ),
  link_counts AS (
    SELECT
      tp.provider AS p,
      -- Links nest per-sku → per-currency, so a non-empty outer object can still hold zero URLs.
      -- Count the leaves, not the keys, or a half-synced provider reads as ready.
      (SELECT COALESCE(SUM(jsonb_array_length(jsonb_path_query_array(v, '$.*'))), 0)
         FROM jsonb_each(COALESCE(tp.test_payment_links, '{}'::jsonb)) AS t(k, v)) AS test_links,
      (SELECT COALESCE(SUM(jsonb_array_length(jsonb_path_query_array(v, '$.*'))), 0)
         FROM jsonb_each(COALESCE(tp.live_payment_links, '{}'::jsonb)) AS t(k, v)) AS live_links
    FROM public.tenant_providers tp
    WHERE tp.tenant_id = p_tenant_id
  )
  SELECT
    tp.provider,
    CASE WHEN tp.provider IN (SELECT p FROM store_kinds) THEN 'store' ELSE 'key_pair' END,
    tp.is_active,

    -- LIVE readiness
    CASE
      WHEN tp.provider IN (SELECT p FROM store_kinds)
        THEN tp.store_credential_enc IS NOT NULL OR tp.provider_account_id IS NOT NULL
      ELSE (tp.live_key_id IS NOT NULL OR tp.provider_account_id IS NOT NULL)
           AND COALESCE(lc.live_links, 0) > 0
    END,

    -- TEST readiness
    CASE
      WHEN tp.provider IN (SELECT p FROM store_kinds)
        THEN COALESCE(ss.n, 0) > 0
      ELSE tp.test_key_id IS NOT NULL AND COALESCE(lc.test_links, 0) > 0
    END,

    -- LIVE detail — quotes the value, so the reader can confirm it
    CASE
      WHEN tp.provider IN (SELECT p FROM store_kinds) THEN
        CASE WHEN tp.store_credential_enc IS NOT NULL OR tp.provider_account_id IS NOT NULL
             THEN 'store credential attached'
             ELSE 'no store credential' END
      WHEN tp.live_key_id IS NULL AND tp.provider_account_id IS NULL THEN 'no live credential'
      WHEN COALESCE(lc.live_links, 0) = 0 THEN 'live credential present but 0 payment links — run product sync'
      -- FINGERPRINT, never the whole key. These are publishable keys, not secrets, but this string
      -- is rendered on a dashboard card, written to request logs and quoted in drift findings — a
      -- key-shaped value in all three is noise at best and a bad habit at worst. Enough to confirm
      -- WHICH key is configured (the point of quoting a value at all) and nothing more.
      ELSE 'live key ' ||
           COALESCE(left(tp.live_key_id, 11) || '…' || right(tp.live_key_id, 4), '(via account)') ||
           ', ' || COALESCE(lc.live_links, 0)::TEXT || ' payment link(s)'
    END,

    -- TEST detail
    CASE
      WHEN tp.provider IN (SELECT p FROM store_kinds) THEN
        CASE WHEN COALESCE(ss.n, 0) > 0
             THEN 'proven — ' || ss.n::TEXT || ' sandbox entitlement(s), last ' ||
                  COALESCE(to_char(ss.last_seen, 'YYYY-MM-DD'), '?')
             ELSE 'not yet proven — no sandbox purchase has reached PayCraft for this provider' END
      WHEN tp.test_key_id IS NULL THEN
        'no test credential — sync can only create LIVE products, so a test build has no link to open'
      WHEN COALESCE(lc.test_links, 0) = 0 THEN
        'test key ' || left(tp.test_key_id, 11) || '…' || right(tp.test_key_id, 4) ||
        ' present but 0 test payment links — run product sync'
      ELSE 'test key ' || left(tp.test_key_id, 11) || '…' || right(tp.test_key_id, 4) ||
           ', ' || COALESCE(lc.test_links, 0)::TEXT || ' payment link(s)'
    END,

    -- How test mode is achieved for this provider
    CASE tp.provider
      WHEN 'google_play' THEN 'license_tester'
      WHEN 'app_store'   THEN 'sandbox_apple_id'
      ELSE 'test_api_key'
    END,

    -- The outstanding human step, or NULL. Each names a CONCRETE action, never a restatement of
    -- the problem — the rule drift-detectors.ts sets for findings.
    CASE
      WHEN tp.provider = 'google_play' AND COALESCE(ss.n, 0) = 0 THEN
        'Play Console → Setup → License testing: add a tester Google account. Real products then ' ||
        'cost that account nothing. There is no test product and no API to verify this — the row ' ||
        'turns green when the first sandbox purchase reaches PayCraft.'
      WHEN tp.provider = 'app_store' AND COALESCE(ss.n, 0) = 0 THEN
        'App Store Connect → Users and Access → Sandbox → Testers: create a sandbox Apple ID, then ' ||
        'sign into it on the device (Settings → App Store → Sandbox Account). Same product ids; ' ||
        'Apple routes verification to the sandbox host. Turns green on the first sandbox purchase.'
      WHEN tp.provider NOT IN (SELECT p FROM store_kinds) AND tp.test_key_id IS NULL THEN
        'Add a ' || tp.provider || ' TEST-mode key in Providers → ' || tp.provider ||
        ', then run product sync — runProductSync writes every configured mode, so test products ' ||
        'are created automatically.'
      WHEN tp.provider NOT IN (SELECT p FROM store_kinds)
           AND tp.test_key_id IS NOT NULL AND COALESCE(lc.test_links, 0) = 0 THEN
        'Run product sync (POST /api/sync/all) — the test key is present but no test links exist yet.'
      ELSE NULL
    END
  FROM public.tenant_providers tp
  LEFT JOIN link_counts   lc ON lc.p = tp.provider
  LEFT JOIN sandbox_seen  ss ON ss.p = tp.provider
  WHERE tp.tenant_id = p_tenant_id
  ORDER BY tp.provider;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_providers_mode_readiness(UUID) TO authenticated, service_role;

COMMENT ON FUNCTION public.tenant_providers_mode_readiness(UUID) IS
  'Per-provider, per-mode readiness. key_pair providers test via a test credential; store providers '
  '(google_play, app_store) have no test product or test credential and are proven by evidence — a '
  'sandbox entitlement that actually landed. Consumed by the dashboard provider cards and by '
  '/idea-paycraft to decide what still needs a human.';
