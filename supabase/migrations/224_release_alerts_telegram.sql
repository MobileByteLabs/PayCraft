-- 224 — release alerts + a Telegram channel (real-time analytics spec 2026-11-28, "Alerts (migration 224)").
--
-- THE GAP
-- 223 stamps every paywall event with app_version / app_build / os_version, but nobody is told when a release
-- breaks the funnel: the attempt-alerts engine (211) only watches purchase attempts and webhooks.
--
-- WHAT THIS ADDS
--   · Three owner alert kinds, evaluated by attempt-alerts every 5 minutes (attempt-stitch → runCritical), stored
--     through tenant_alert_record (211, 24 h dedupe per (tenant, kind, dedupe_key)), each with a toggle on
--     tenant_alert_prefs (default ON):
--       release_regression  newest app_version (>= 30 paywall-view devices) has a purchase rate < 50% of the
--                           previous version's, OR a sign-in fail share > 2x the previous      key: app_version
--       sign_in_failing     >= 5 paycraft_sign_in_fail and fail share > 30% in the last 60 min key: hour bucket
--       paywall_silent      0 paycraft_paywall_view in the last 60 min while the prior 7 days' same-hour mean
--                           is >= 5                                                           key: hour bucket
--     fail share = sign_in_fail / (sign_in_fail + sign_in_complete). Live mode only.
--     The read-only aggregates below return the candidates (the volume gates as parameters, like 211's spike
--     function); the ratio thresholds are decided in attempt-alerts/analytics-rules.ts.
--   · tenant_alert_channels + telegram_bot_token_enc (pgcrypto via encrypt_provider_key, the 208 passphrase —
--     exactly like slack_url_enc) + telegram_chat_id. tenant_alert_channels_save accepts / clears them,
--     tenant_alert_channels_status reports telegram_configured only (the token never comes back), and
--     tenant_alert_channels_decrypt hands both to the sender (service_role only).
--   · alert_deliveries.channel accepts 'telegram'.
--
-- Depends on 223 (paywall_events.app_version / app_build). Idempotent: ADD COLUMN IF NOT EXISTS, constraints
-- dropped and re-added by name, DROP FUNCTION IF EXISTS before a signature / result change, CREATE OR REPLACE.

-- ── 1. Telegram channel ────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tenant_alert_channels
  ADD COLUMN IF NOT EXISTS telegram_bot_token_enc BYTEA,   -- NULL = Telegram off
  ADD COLUMN IF NOT EXISTS telegram_chat_id       TEXT;    -- NULL iff telegram_bot_token_enc NULL (CHECK below)

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_alert_channels_telegram_pair') THEN
    ALTER TABLE public.tenant_alert_channels
      ADD CONSTRAINT tenant_alert_channels_telegram_pair
      CHECK ((telegram_bot_token_enc IS NULL) = (telegram_chat_id IS NULL));
  END IF;
END $$;

COMMENT ON COLUMN public.tenant_alert_channels.telegram_bot_token_enc IS
  'Telegram bot token, pgcrypto-encrypted (encrypt_provider_key). Written via tenant_alert_channels_save, never returned to the dashboard.';

ALTER TABLE public.alert_deliveries DROP CONSTRAINT IF EXISTS alert_deliveries_channel_check;
ALTER TABLE public.alert_deliveries ADD CONSTRAINT alert_deliveries_channel_check
  CHECK (channel IN ('email', 'slack', 'webhook', 'inbox', 'telegram'));

-- Writer: 211's rules unchanged, plus Telegram. Token: NULL keeps, '' clears token AND chat id; a new token needs
-- a chat id unless one is stored. Chat id alone re-points a stored token.
DROP FUNCTION IF EXISTS public.tenant_alert_channels_save(UUID, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN);
CREATE OR REPLACE FUNCTION public.tenant_alert_channels_save(
  p_tenant_id          UUID,
  p_email_enabled      BOOLEAN,
  p_slack_url          TEXT,
  p_webhook_url        TEXT,
  p_webhook_secret     TEXT,
  p_inbox_enabled      BOOLEAN,
  p_telegram_bot_token TEXT DEFAULT NULL,
  p_telegram_chat_id   TEXT DEFAULT NULL
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_service BOOLEAN := auth.role() IS NOT DISTINCT FROM 'service_role';
  v_url_re  TEXT    := CASE WHEN auth.role() IS NOT DISTINCT FROM 'service_role' THEN '^https?://[^/\s]+' ELSE '^https://[^/\s]+' END;
  v_has_secret BOOLEAN;
  v_has_token  BOOLEAN;
BEGIN
  IF NOT v_service
     AND NOT EXISTS (SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF COALESCE(p_slack_url, '') <> '' AND (p_slack_url !~ v_url_re OR length(p_slack_url) > 2048) THEN
    RAISE EXCEPTION 'slack_url_invalid' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_webhook_url, '') <> '' AND (p_webhook_url !~ v_url_re OR length(p_webhook_url) > 2048) THEN
    RAISE EXCEPTION 'webhook_url_invalid' USING ERRCODE = '22023';
  END IF;
  IF COALESCE(p_webhook_secret, '') <> '' AND length(p_webhook_secret) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION 'webhook_secret_length' USING ERRCODE = '22023';
  END IF;
  -- BotFather tokens: "<bot id>:<35-char secret>".
  IF COALESCE(p_telegram_bot_token, '') <> '' AND p_telegram_bot_token !~ '^[0-9]{5,20}:[A-Za-z0-9_-]{30,100}$' THEN
    RAISE EXCEPTION 'telegram_token_invalid' USING ERRCODE = '22023';
  END IF;
  -- A numeric chat id (groups are negative, supergroups -100…) or a public @channelname.
  IF COALESCE(p_telegram_chat_id, '') <> '' AND p_telegram_chat_id !~ '^(-?[0-9]{1,20}|@[A-Za-z][A-Za-z0-9_]{4,31})$' THEN
    RAISE EXCEPTION 'telegram_chat_id_invalid' USING ERRCODE = '22023';
  END IF;

  INSERT INTO tenant_alert_channels (tenant_id, email_enabled, inbox_enabled, updated_at)
  VALUES (p_tenant_id, COALESCE(p_email_enabled, TRUE), COALESCE(p_inbox_enabled, TRUE), now())
  ON CONFLICT (tenant_id) DO UPDATE
    SET email_enabled = COALESCE(p_email_enabled, tenant_alert_channels.email_enabled),
        inbox_enabled = COALESCE(p_inbox_enabled, tenant_alert_channels.inbox_enabled),
        updated_at    = now();

  IF p_slack_url = '' THEN
    UPDATE tenant_alert_channels SET slack_url_enc = NULL, updated_at = now() WHERE tenant_id = p_tenant_id;
  ELSIF p_slack_url IS NOT NULL THEN
    UPDATE tenant_alert_channels SET slack_url_enc = encrypt_provider_key(p_slack_url), updated_at = now()
     WHERE tenant_id = p_tenant_id;
  END IF;

  SELECT webhook_secret_enc IS NOT NULL, telegram_bot_token_enc IS NOT NULL
    INTO v_has_secret, v_has_token
    FROM tenant_alert_channels WHERE tenant_id = p_tenant_id;
  IF p_webhook_url = '' THEN
    UPDATE tenant_alert_channels SET webhook_url_enc = NULL, webhook_secret_enc = NULL, updated_at = now()
     WHERE tenant_id = p_tenant_id;
  ELSIF p_webhook_url IS NOT NULL THEN
    IF COALESCE(p_webhook_secret, '') = '' AND NOT v_has_secret THEN
      RAISE EXCEPTION 'webhook_secret_required' USING ERRCODE = '22023';
    END IF;
    UPDATE tenant_alert_channels
       SET webhook_url_enc    = encrypt_provider_key(p_webhook_url),
           webhook_secret_enc = CASE WHEN COALESCE(p_webhook_secret, '') = '' THEN webhook_secret_enc
                                     ELSE encrypt_provider_key(p_webhook_secret) END,
           updated_at         = now()
     WHERE tenant_id = p_tenant_id;
  ELSIF COALESCE(p_webhook_secret, '') <> '' THEN
    IF NOT v_has_secret THEN
      RAISE EXCEPTION 'webhook_url_required' USING ERRCODE = '22023';
    END IF;
    UPDATE tenant_alert_channels SET webhook_secret_enc = encrypt_provider_key(p_webhook_secret), updated_at = now()
     WHERE tenant_id = p_tenant_id;
  END IF;

  IF p_telegram_bot_token = '' THEN
    UPDATE tenant_alert_channels SET telegram_bot_token_enc = NULL, telegram_chat_id = NULL, updated_at = now()
     WHERE tenant_id = p_tenant_id;
  ELSIF p_telegram_bot_token IS NOT NULL THEN
    IF COALESCE(p_telegram_chat_id, '') = '' AND NOT v_has_token THEN
      RAISE EXCEPTION 'telegram_chat_id_required' USING ERRCODE = '22023';
    END IF;
    UPDATE tenant_alert_channels
       SET telegram_bot_token_enc = encrypt_provider_key(p_telegram_bot_token),
           telegram_chat_id       = COALESCE(NULLIF(p_telegram_chat_id, ''), telegram_chat_id),
           updated_at             = now()
     WHERE tenant_id = p_tenant_id;
  ELSIF COALESCE(p_telegram_chat_id, '') <> '' THEN
    IF NOT v_has_token THEN
      RAISE EXCEPTION 'telegram_token_required' USING ERRCODE = '22023';
    END IF;
    UPDATE tenant_alert_channels SET telegram_chat_id = p_telegram_chat_id, updated_at = now()
     WHERE tenant_id = p_tenant_id;
  END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.tenant_alert_channels_save(UUID, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_alert_channels_save(UUID, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT) TO authenticated, service_role;

-- Non-secret status (+ telegram_configured). The result columns change → drop and recreate.
DROP FUNCTION IF EXISTS public.tenant_alert_channels_status(UUID);
CREATE FUNCTION public.tenant_alert_channels_status(p_tenant_id UUID)
RETURNS TABLE (email_enabled BOOLEAN, slack_configured BOOLEAN, webhook_configured BOOLEAN,
               inbox_enabled BOOLEAN, updated_at TIMESTAMPTZ, telegram_configured BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT COALESCE(c.email_enabled, TRUE), c.slack_url_enc IS NOT NULL, c.webhook_url_enc IS NOT NULL,
         COALESCE(c.inbox_enabled, TRUE), c.updated_at,
         c.telegram_bot_token_enc IS NOT NULL AND c.telegram_chat_id IS NOT NULL
    FROM tenants t LEFT JOIN tenant_alert_channels c ON c.tenant_id = t.id
   WHERE t.id = p_tenant_id;
END;
$$;
REVOKE ALL ON FUNCTION public.tenant_alert_channels_status(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_alert_channels_status(UUID) TO authenticated, service_role;

-- Decrypt (218's shape + the Telegram destination) — the sender only.
DROP FUNCTION IF EXISTS public.tenant_alert_channels_decrypt(UUID);
CREATE FUNCTION public.tenant_alert_channels_decrypt(p_tenant_id UUID)
RETURNS TABLE (owner_email TEXT, email_enabled BOOLEAN, inbox_enabled BOOLEAN,
               slack_url TEXT, webhook_url TEXT, webhook_secret TEXT, app_name TEXT,
               telegram_bot_token TEXT, telegram_chat_id TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT t.owner_email::TEXT,
         COALESCE(c.email_enabled, TRUE),
         COALESCE(c.inbox_enabled, TRUE),
         CASE WHEN c.slack_url_enc          IS NULL THEN NULL ELSE decrypt_provider_key(c.slack_url_enc)::TEXT END,
         CASE WHEN c.webhook_url_enc        IS NULL THEN NULL ELSE decrypt_provider_key(c.webhook_url_enc)::TEXT END,
         CASE WHEN c.webhook_secret_enc     IS NULL THEN NULL ELSE decrypt_provider_key(c.webhook_secret_enc)::TEXT END,
         NULLIF(btrim(t.name), '')::TEXT,
         CASE WHEN c.telegram_bot_token_enc IS NULL THEN NULL ELSE decrypt_provider_key(c.telegram_bot_token_enc)::TEXT END,
         c.telegram_chat_id
    FROM tenants t LEFT JOIN tenant_alert_channels c ON c.tenant_id = t.id
   WHERE t.id = p_tenant_id;
END;
$$;
REVOKE ALL ON FUNCTION public.tenant_alert_channels_decrypt(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_alert_channels_decrypt(UUID) TO service_role;

-- ── 2. The three kinds: allowed on tenant_alerts, toggled on tenant_alert_prefs ─────────────────────────
ALTER TABLE public.tenant_alert_prefs
  ADD COLUMN IF NOT EXISTS release_regression BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS sign_in_failing    BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS paywall_silent     BOOLEAN NOT NULL DEFAULT TRUE;

ALTER TABLE public.tenant_alerts DROP CONSTRAINT IF EXISTS tenant_alerts_shape;
ALTER TABLE public.tenant_alerts ADD CONSTRAINT tenant_alerts_shape CHECK (
      kind IN ('paid_not_granted', 'webhook_sig_fail', 'webhook_proc_fail', 'failure_rate_spike',
               'abandon_digest', 'decline_digest', 'limit_warn', 'limit_hit', 'webhook_fail', 'sub_expiry',
               'ai_insight', 'channel_test', 'release_regression', 'sign_in_failing', 'paywall_silent')
  AND severity IN ('critical', 'digest')
  AND length(dedupe_key) BETWEEN 1 AND 200
  AND length(title) BETWEEN 1 AND 200
  AND length(body) <= 4000
  AND (body_html IS NULL OR length(body_html) <= 20000)
  AND (stage IS NULL OR stage IN ('sdk', 'server', 'provider', 'webhook', 'entitlement'))
  AND (code IS NULL OR length(code) <= 48)
  AND (correlation IS NULL OR correlation IN ('exact', 'inferred')));

-- 211's body, with the three toggles added to the CASE.
CREATE OR REPLACE FUNCTION public.tenant_alert_record(
  p_tenant_id   UUID,
  p_kind        TEXT,
  p_severity    TEXT,
  p_dedupe_key  TEXT,
  p_title       TEXT,
  p_body        TEXT,
  p_payload     JSONB       DEFAULT '{}'::jsonb,
  p_body_html   TEXT        DEFAULT NULL,
  p_stage       TEXT        DEFAULT NULL,
  p_code        TEXT        DEFAULT NULL,
  p_correlation TEXT        DEFAULT NULL,
  p_now         TIMESTAMPTZ DEFAULT now()
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_on BOOLEAN;
  v_id UUID;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  SELECT CASE p_kind
           WHEN 'paid_not_granted'   THEN p.paid_not_granted
           WHEN 'webhook_sig_fail'   THEN p.webhook_sig_fail
           WHEN 'webhook_proc_fail'  THEN p.webhook_proc_fail
           WHEN 'failure_rate_spike' THEN p.failure_rate_spike
           WHEN 'abandon_digest'     THEN p.abandon_digest
           WHEN 'decline_digest'     THEN p.decline_digest
           WHEN 'limit_warn'         THEN p.limit_warn
           WHEN 'limit_hit'          THEN p.limit_hit
           WHEN 'webhook_fail'       THEN p.webhook_fail
           WHEN 'sub_expiry'         THEN p.sub_expiry
           WHEN 'release_regression' THEN p.release_regression
           WHEN 'sign_in_failing'    THEN p.sign_in_failing
           WHEN 'paywall_silent'     THEN p.paywall_silent
           ELSE TRUE
         END
    INTO v_on
    FROM tenant_alert_prefs p WHERE p.tenant_id = p_tenant_id;
  IF v_on IS FALSE THEN RETURN NULL; END IF;   -- no prefs row = every kind on (025's defaults)

  BEGIN
    INSERT INTO tenant_alerts (tenant_id, kind, severity, dedupe_key, title, body, body_html, stage, code,
                               correlation, payload, created_at)
    VALUES (p_tenant_id, p_kind, p_severity, left(p_dedupe_key, 200), left(p_title, 200), left(COALESCE(p_body, ''), 4000),
            p_body_html, p_stage, left(p_code, 48), p_correlation, COALESCE(p_payload, '{}'::jsonb), p_now)
    RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    RETURN NULL;
  END;
  RETURN v_id;
END;
$$;
REVOKE ALL ON FUNCTION public.tenant_alert_record(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_alert_record(UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, TEXT, TEXT, TIMESTAMPTZ) TO service_role;

-- ── 3. What the rules evaluate — read-only, live mode, service_role, clock injectable ──────────────────

-- Per tenant: the newest app_version seen in the window (highest app_build, then latest first sighting) when it
-- has >= p_min_devices paywall-view devices, against the version right before it. Rates are NULL when their
-- denominator is 0. purchase_rate = purchase devices / paywall-view devices (distinct device_ref);
-- sign_in_fail_share = sign_in_fail / (sign_in_fail + sign_in_complete) events.
CREATE OR REPLACE FUNCTION public.analytics_alert_release_regression(
  p_now         TIMESTAMPTZ DEFAULT now(),
  p_window_days INT DEFAULT 7,
  p_min_devices INT DEFAULT 30)
RETURNS TABLE (tenant_id UUID, app_version TEXT, paywall_view_devices INT, purchase_devices INT, purchase_rate NUMERIC,
               sign_in_fails INT, sign_in_completes INT, sign_in_fail_share NUMERIC,
               previous_version TEXT, prev_paywall_view_devices INT, prev_purchase_devices INT, prev_purchase_rate NUMERIC,
               prev_sign_in_fails INT, prev_sign_in_completes INT, prev_sign_in_fail_share NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH v AS (
    SELECT e.tenant_id AS t, e.app_version AS ver,
           count(DISTINCT e.device_ref) FILTER (WHERE e.name = 'paycraft_paywall_view')::INT     AS views,
           count(DISTINCT e.device_ref) FILTER (WHERE e.name = 'paycraft_purchase_success')::INT AS buys,
           count(*) FILTER (WHERE e.name = 'paycraft_sign_in_fail')::INT                          AS fails,
           count(*) FILTER (WHERE e.name = 'paycraft_sign_in_complete')::INT                      AS oks,
           max(e.app_build) AS build,
           min(e.occurred_at) AS first_seen
      FROM paywall_events e
     WHERE e.mode = 'live' AND e.app_version IS NOT NULL
       AND e.occurred_at > p_now - make_interval(days => p_window_days) AND e.occurred_at <= p_now
     GROUP BY e.tenant_id, e.app_version
  ), r AS (
    SELECT v.*,
           round(v.buys::NUMERIC / NULLIF(v.views, 0), 4) AS rate,
           round(v.fails::NUMERIC / NULLIF(v.fails + v.oks, 0), 4) AS share,
           row_number() OVER (PARTITION BY v.t ORDER BY v.build DESC NULLS LAST, v.first_seen DESC, v.ver DESC) AS rk
      FROM v
  )
  SELECT n.t, n.ver, n.views, n.buys, n.rate, n.fails, n.oks, n.share,
         p.ver, p.views, p.buys, p.rate, p.fails, p.oks, p.share
    FROM r n JOIN r p ON p.t = n.t AND p.rk = 2
   WHERE n.rk = 1 AND n.views >= p_min_devices
   ORDER BY n.t;
END;
$$;

-- Per tenant with >= p_min_fails sign-in failures in the last p_window_minutes: fails, completes, the share and
-- the failures by provider.
CREATE OR REPLACE FUNCTION public.analytics_alert_sign_in_failing(
  p_now            TIMESTAMPTZ DEFAULT now(),
  p_window_minutes INT DEFAULT 60,
  p_min_fails      INT DEFAULT 5)
RETURNS TABLE (tenant_id UUID, sign_in_fails INT, sign_in_completes INT, sign_in_fail_share NUMERIC,
               fails_by_provider JSONB, window_start TIMESTAMPTZ, window_end TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH w AS (
    SELECT e.tenant_id AS t, e.name, COALESCE(e.provider, 'unknown') AS provider
      FROM paywall_events e
     WHERE e.mode = 'live' AND e.name IN ('paycraft_sign_in_fail', 'paycraft_sign_in_complete')
       AND e.occurred_at > p_now - make_interval(mins => p_window_minutes) AND e.occurred_at <= p_now
  ), agg AS (
    SELECT w.t,
           count(*) FILTER (WHERE w.name = 'paycraft_sign_in_fail')::INT     AS fails,
           count(*) FILTER (WHERE w.name = 'paycraft_sign_in_complete')::INT AS oks
      FROM w GROUP BY w.t
  )
  SELECT a.t, a.fails, a.oks, round(a.fails::NUMERIC / NULLIF(a.fails + a.oks, 0), 4),
         (SELECT jsonb_object_agg(x.provider, x.n) FROM (
             SELECT w.provider, count(*) n FROM w WHERE w.t = a.t AND w.name = 'paycraft_sign_in_fail' GROUP BY w.provider) x),
         p_now - make_interval(mins => p_window_minutes), p_now
    FROM agg a
   WHERE a.fails >= p_min_fails
   ORDER BY a.t;
END;
$$;

-- Per tenant whose paywall views in the same p_window_minutes of each of the previous 7 days average
-- >= p_min_baseline: the views in the current window (the engine alerts on 0) and that mean.
CREATE OR REPLACE FUNCTION public.analytics_alert_paywall_silent(
  p_now            TIMESTAMPTZ DEFAULT now(),
  p_window_minutes INT DEFAULT 60,
  p_min_baseline   NUMERIC DEFAULT 5)
RETURNS TABLE (tenant_id UUID, paywall_views INT, baseline_mean NUMERIC, window_start TIMESTAMPTZ, window_end TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH base AS (
    SELECT e.tenant_id AS t, round(count(*)::NUMERIC / 7, 2) AS mean
      FROM paywall_events e
      JOIN generate_series(1, 7) AS d(n)
        ON e.occurred_at >  p_now - make_interval(days => d.n) - make_interval(mins => p_window_minutes)
       AND e.occurred_at <= p_now - make_interval(days => d.n)
     WHERE e.mode = 'live' AND e.name = 'paycraft_paywall_view'
       AND e.occurred_at > p_now - interval '7 days' - make_interval(mins => p_window_minutes)
       AND e.occurred_at <= p_now - interval '1 day'
     GROUP BY e.tenant_id
  )
  SELECT b.t,
         (SELECT count(*)::INT FROM paywall_events c
           WHERE c.tenant_id = b.t AND c.mode = 'live' AND c.name = 'paycraft_paywall_view'
             AND c.occurred_at > p_now - make_interval(mins => p_window_minutes) AND c.occurred_at <= p_now),
         b.mean, p_now - make_interval(mins => p_window_minutes), p_now
    FROM base b
   WHERE b.mean >= p_min_baseline
   ORDER BY b.t;
END;
$$;

REVOKE ALL ON FUNCTION public.analytics_alert_release_regression(TIMESTAMPTZ, INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_alert_sign_in_failing(TIMESTAMPTZ, INT, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_alert_paywall_silent(TIMESTAMPTZ, INT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_alert_release_regression(TIMESTAMPTZ, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.analytics_alert_sign_in_failing(TIMESTAMPTZ, INT, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.analytics_alert_paywall_silent(TIMESTAMPTZ, INT, NUMERIC) TO service_role;
