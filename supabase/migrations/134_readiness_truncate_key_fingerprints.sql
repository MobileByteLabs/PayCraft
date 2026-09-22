-- 134_readiness_truncate_key_fingerprints.sql
--
-- Redefine tenant_providers_mode_readiness so `live_detail` / `test_detail` quote a key
-- FINGERPRINT (`pk_live_51R…aVcn`) instead of the whole credential.
--
-- WHY A NEW MIGRATION RATHER THAN AN EDIT TO 133
-- 133 was already applied to production. CLAUDE.md: "Edits to existing migrations are forbidden
-- once applied in any environment; add a follow-up migration instead." That rule earned itself here
-- — 133 WAS edited in place, and because `db push` only runs un-applied migrations the change never
-- reached prod while the file on disk looked fixed. The next reader (or a `db reset`) would have
-- gotten a different function than production was running. This migration is the only thing that
-- makes the two agree.
--
-- WHY IT MATTERS AT ALL
-- These are publishable keys (`pk_live_*`), public by design and already embedded in every shipped
-- client — not secrets, and no rotation is implied. But `live_detail` is rendered on a dashboard
-- card, written into request logs and quoted in drift findings, and a full credential-shaped string
-- in all three is noise that trains people to scroll past key-looking text. The fingerprint keeps
-- the only property that was ever useful — WHICH key is configured — and drops the rest.
--
-- Everything else about the function is unchanged; only the two detail expressions differ.

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
  -- The only change from 133: a reusable fingerprint instead of the raw key.
  fp AS (
    SELECT
      tp.provider AS p,
      CASE WHEN tp.live_key_id IS NULL THEN NULL
           ELSE left(tp.live_key_id, 11) || '…' || right(tp.live_key_id, 4) END AS live_fp,
      CASE WHEN tp.test_key_id IS NULL THEN NULL
           ELSE left(tp.test_key_id, 11) || '…' || right(tp.test_key_id, 4) END AS test_fp
    FROM public.tenant_providers tp
    WHERE tp.tenant_id = p_tenant_id
  )
  SELECT
    tp.provider,
    CASE WHEN tp.provider IN (SELECT p FROM store_kinds) THEN 'store' ELSE 'key_pair' END,
    tp.is_active,
    CASE
      WHEN tp.provider IN (SELECT p FROM store_kinds)
        THEN tp.store_credential_enc IS NOT NULL OR tp.provider_account_id IS NOT NULL
      ELSE (tp.live_key_id IS NOT NULL OR tp.provider_account_id IS NOT NULL)
           AND COALESCE(lc.live_links, 0) > 0
    END,
    CASE
      WHEN tp.provider IN (SELECT p FROM store_kinds) THEN COALESCE(ss.n, 0) > 0
      ELSE tp.test_key_id IS NOT NULL AND COALESCE(lc.test_links, 0) > 0
    END,
    CASE
      WHEN tp.provider IN (SELECT p FROM store_kinds) THEN
        CASE WHEN tp.store_credential_enc IS NOT NULL OR tp.provider_account_id IS NOT NULL
             THEN 'store credential attached' ELSE 'no store credential' END
      WHEN tp.live_key_id IS NULL AND tp.provider_account_id IS NULL THEN 'no live credential'
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
      WHEN tp.test_key_id IS NULL THEN
        'no test credential — sync can only create LIVE products, so a test build has no link to open'
      WHEN COALESCE(lc.test_links, 0) = 0 THEN
        'test key ' || f.test_fp || ' present but 0 test payment links — run product sync'
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
  LEFT JOIN link_counts  lc ON lc.p = tp.provider
  LEFT JOIN sandbox_seen ss ON ss.p = tp.provider
  LEFT JOIN fp           f  ON f.p  = tp.provider
  WHERE tp.tenant_id = p_tenant_id
  ORDER BY tp.provider;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_providers_mode_readiness(UUID) TO authenticated, service_role;
