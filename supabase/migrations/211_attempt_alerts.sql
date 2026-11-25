-- 211 — owner alerts for purchase attempts: channels, stored alerts, the delivery ledger, the rule
-- aggregates and the four pg_cron schedules (paycraft-attempt-observability GOAL D8 / D9 / D15, AC-7 / AC-8).
--
-- THE GAP
-- 210 records every attempt and its failures, but nobody is told: tenant-alerts (025) only emails four
-- legacy kinds, has never had a schedule, and the dashboard's Slack field was never persisted.
--
-- WHAT THIS ADDS
--   · tenant_alert_channels — per tenant: email on/off, Slack incoming-webhook URL, outbound webhook URL +
--     HMAC secret, inbox on/off. The Slack URL and the webhook URL + secret are pgcrypto-encrypted with the
--     SAME helpers as tenant_attribution_integrations (208): encrypt_provider_key / decrypt_provider_key over
--     app.encryption_key. The dashboard writes through tenant_alert_channels_save and reads only the
--     non-secret tenant_alert_channels_status; the sender (service_role) decrypts. Nothing in between sees
--     plaintext.
--   · tenant_alert_prefs (025) gains one toggle per new alert kind (additive — legacy columns untouched).
--   · tenant_alerts — every owner alert is STORED FIRST (the SoT and the dashboard inbox), then delivered.
--     24 h dedupe per (tenant, kind, dedupe_key) is enforced by the table itself, whoever inserts.
--   · alert_deliveries — one row per (alert, channel), the attribution_forwards (208) ledger shape:
--     status / attempts / http_status / error / next_retry_at, retried with 2^attempts-minute backoff.
--   · Read-only aggregates the attempt-alerts engine evaluates (D9) — paid_not_granted, webhook signature /
--     processing failures, failure-rate spikes, the hourly abandon / decline digests — each with the clock
--     a parameter so tests inject it.
--   · paycraft_function_post(path) — the pg_net call every schedule makes; a database without the vault
--     entries (local, CI, a fresh self-host) schedules jobs that do nothing, exactly like 187.
--   · Four schedules (AC-8): attempt-alerts digest hourly, attempt-stitch every 5 min (which also runs the
--     critical alert rules), tenant-alerts hourly (unscheduled since 025), attempt-insights weekly through
--     attempt_insights_dispatch() — a no-op here that 212 (phase 6) replaces with the real call. Plus the
--     daily tier-retention purge for attempts (210) and alerts (D15), which nothing scheduled before.
--
-- Production provisioning (once; 187 already provisions the last two, which this reuses):
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'paycraft_functions_url');
--   -- falls back to paycraft_store_sync_url minus '/store-sync' when absent
--   select vault.create_secret('<service-role key>', 'paycraft_service_role_key');
--
-- Idempotent: CREATE … IF NOT EXISTS / ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE / DROP … IF EXISTS /
-- ADD CONSTRAINT guarded by pg_constraint; cron.schedule replaces a job of the same name.

-- ── 1. Channels ───────────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.tenant_alert_channels (
  tenant_id          UUID        PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  email_enabled      BOOLEAN     NOT NULL DEFAULT TRUE,
  slack_url_enc      BYTEA,                               -- NULL = Slack off
  webhook_url_enc    BYTEA,                               -- NULL = outbound webhook off
  webhook_secret_enc BYTEA,                               -- NULL iff webhook_url_enc NULL (CHECK below)
  inbox_enabled      BOOLEAN     NOT NULL DEFAULT TRUE,   -- the dashboard inbox (ledger-only channel)
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_alert_channels_webhook_pair') THEN
    ALTER TABLE public.tenant_alert_channels
      ADD CONSTRAINT tenant_alert_channels_webhook_pair
      CHECK ((webhook_url_enc IS NULL) = (webhook_secret_enc IS NULL));
  END IF;
END $$;
ALTER TABLE public.tenant_alert_channels ENABLE ROW LEVEL SECURITY;
-- No policies: service_role only. Tenant admins go through the RPCs below (208's shape).
REVOKE ALL ON public.tenant_alert_channels FROM anon, authenticated;

COMMENT ON TABLE public.tenant_alert_channels IS
  'Owner alert destinations per tenant. Slack URL and outbound webhook URL + HMAC secret pgcrypto-encrypted (encrypt_provider_key); written via tenant_alert_channels_save, never returned to the dashboard.';

-- Per-kind toggles on 025's tenant_alert_prefs. Additive — legacy columns (welcome / limit_* / webhook_fail
-- / sub_expiry) stay as they are.
ALTER TABLE public.tenant_alert_prefs
  ADD COLUMN IF NOT EXISTS paid_not_granted   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS webhook_sig_fail   BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS webhook_proc_fail  BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS failure_rate_spike BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS abandon_digest     BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS decline_digest     BOOLEAN NOT NULL DEFAULT TRUE;

-- Writer. Slack: NULL keeps the stored URL, '' clears it. Webhook: NULL keeps, '' clears URL AND secret; a
-- new URL needs a secret unless one is already stored (rotate the secret alone by passing p_webhook_url NULL).
-- A tenant admin may only point a channel at https://; the service role (operators, test harnesses) may also
-- use http:// for a local endpoint.
CREATE OR REPLACE FUNCTION public.tenant_alert_channels_save(
  p_tenant_id      UUID,
  p_email_enabled  BOOLEAN,
  p_slack_url      TEXT,
  p_webhook_url    TEXT,
  p_webhook_secret TEXT,
  p_inbox_enabled  BOOLEAN
) RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_service BOOLEAN := auth.role() IS NOT DISTINCT FROM 'service_role';
  v_url_re  TEXT    := CASE WHEN auth.role() IS NOT DISTINCT FROM 'service_role' THEN '^https?://[^/\s]+' ELSE '^https://[^/\s]+' END;
  v_has_secret BOOLEAN;
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

  SELECT webhook_secret_enc IS NOT NULL INTO v_has_secret FROM tenant_alert_channels WHERE tenant_id = p_tenant_id;
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
END;
$$;
REVOKE ALL ON FUNCTION public.tenant_alert_channels_save(UUID, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_alert_channels_save(UUID, BOOLEAN, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated, service_role;

-- Non-secret status — what the dashboard renders (secrets are never returned). Defaults when never saved.
CREATE OR REPLACE FUNCTION public.tenant_alert_channels_status(p_tenant_id UUID)
RETURNS TABLE (email_enabled BOOLEAN, slack_configured BOOLEAN, webhook_configured BOOLEAN,
               inbox_enabled BOOLEAN, updated_at TIMESTAMPTZ)
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
         COALESCE(c.inbox_enabled, TRUE), c.updated_at
    FROM tenants t LEFT JOIN tenant_alert_channels c ON c.tenant_id = t.id
   WHERE t.id = p_tenant_id;
END;
$$;
REVOKE ALL ON FUNCTION public.tenant_alert_channels_status(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_alert_channels_status(UUID) TO authenticated, service_role;

-- Decrypt: the sender (edge functions, service_role) ONLY — every delivery target of one tenant, with the
-- defaults (email + inbox on) for a tenant that never saved channels. Not granted to authenticated.
CREATE OR REPLACE FUNCTION public.tenant_alert_channels_decrypt(p_tenant_id UUID)
RETURNS TABLE (owner_email TEXT, email_enabled BOOLEAN, inbox_enabled BOOLEAN,
               slack_url TEXT, webhook_url TEXT, webhook_secret TEXT)
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
         CASE WHEN c.slack_url_enc      IS NULL THEN NULL ELSE decrypt_provider_key(c.slack_url_enc)::TEXT END,
         CASE WHEN c.webhook_url_enc    IS NULL THEN NULL ELSE decrypt_provider_key(c.webhook_url_enc)::TEXT END,
         CASE WHEN c.webhook_secret_enc IS NULL THEN NULL ELSE decrypt_provider_key(c.webhook_secret_enc)::TEXT END
    FROM tenants t LEFT JOIN tenant_alert_channels c ON c.tenant_id = t.id
   WHERE t.id = p_tenant_id;
END;
$$;
REVOKE ALL ON FUNCTION public.tenant_alert_channels_decrypt(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_alert_channels_decrypt(UUID) TO service_role;

-- ── 2. Stored alerts — the SoT for every owner alert and the dashboard inbox ──────────────────────────
-- Every channel delivery is a row in alert_deliveries pointing here. The inbox reads WHERE read_at IS NULL.
CREATE TABLE IF NOT EXISTS public.tenant_alerts (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind        TEXT        NOT NULL,
  severity    TEXT        NOT NULL,
  dedupe_key  TEXT        NOT NULL,  -- attempt_id (paid_not_granted) · error class (webhook) · stage (spike) · 'hour-YYYY-MM-DDTHH' (digests) · kind (legacy)
  title       TEXT        NOT NULL,
  body        TEXT        NOT NULL DEFAULT '',
  body_html   TEXT,                  -- a hand-made email body (025's templates); NULL = rendered from title + body
  stage       TEXT,                  -- the attempt stage the alert is about, when there is one
  code        TEXT,                  -- the error code it is about, when there is one
  correlation TEXT,                  -- exact | inferred, for a single-attempt alert
  payload     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at     TIMESTAMPTZ
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_alerts_shape') THEN
    ALTER TABLE public.tenant_alerts ADD CONSTRAINT tenant_alerts_shape CHECK (
          kind IN ('paid_not_granted', 'webhook_sig_fail', 'webhook_proc_fail', 'failure_rate_spike',
                   'abandon_digest', 'decline_digest', 'limit_warn', 'limit_hit', 'webhook_fail', 'sub_expiry',
                   'ai_insight', 'channel_test')
      AND severity IN ('critical', 'digest')
      AND length(dedupe_key) BETWEEN 1 AND 200
      AND length(title) BETWEEN 1 AND 200
      AND length(body) <= 4000
      AND (body_html IS NULL OR length(body_html) <= 20000)
      AND (stage IS NULL OR stage IN ('sdk', 'server', 'provider', 'webhook', 'entitlement'))
      AND (code IS NULL OR length(code) <= 48)
      AND (correlation IS NULL OR correlation IN ('exact', 'inferred')));
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS tenant_alerts_dedupe ON public.tenant_alerts (tenant_id, kind, dedupe_key, created_at DESC);
CREATE INDEX IF NOT EXISTS tenant_alerts_inbox  ON public.tenant_alerts (tenant_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS tenant_alerts_tenant_created ON public.tenant_alerts (tenant_id, created_at DESC);

-- 24 h dedupe per (tenant, kind, dedupe_key), held by the table whoever inserts. A true rolling window (a
-- calendar-day unique index would re-alert at midnight, and date_trunc on timestamptz is not indexable).
-- The advisory lock serialises two concurrent inserts of the same key, so exactly one of them lands.
CREATE OR REPLACE FUNCTION public.tenant_alerts_dedupe_24h() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('tenant_alerts:' || NEW.tenant_id || ':' || NEW.kind || ':' || NEW.dedupe_key, 0));
  IF EXISTS (SELECT 1 FROM public.tenant_alerts a
              WHERE a.tenant_id = NEW.tenant_id AND a.kind = NEW.kind AND a.dedupe_key = NEW.dedupe_key
                AND a.created_at > NEW.created_at - interval '24 hours'
                AND a.created_at < NEW.created_at + interval '24 hours') THEN
    RAISE EXCEPTION 'tenant_alerts_dedupe_24h: % / % / % already alerted within 24 h', NEW.tenant_id, NEW.kind, NEW.dedupe_key
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS tenant_alerts_dedupe ON public.tenant_alerts;
CREATE TRIGGER tenant_alerts_dedupe BEFORE INSERT ON public.tenant_alerts
  FOR EACH ROW EXECUTE FUNCTION public.tenant_alerts_dedupe_24h();

ALTER TABLE public.tenant_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_alerts_admin_read ON public.tenant_alerts;
CREATE POLICY tenant_alerts_admin_read ON public.tenant_alerts FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT ta.tenant_id FROM public.tenant_admins ta WHERE ta.user_id = auth.uid()));
-- The inbox marks an alert read; read_at is the ONLY column a tenant admin can write.
DROP POLICY IF EXISTS tenant_alerts_admin_mark_read ON public.tenant_alerts;
CREATE POLICY tenant_alerts_admin_mark_read ON public.tenant_alerts FOR UPDATE TO authenticated
  USING (tenant_id IN (SELECT ta.tenant_id FROM public.tenant_admins ta WHERE ta.user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT ta.tenant_id FROM public.tenant_admins ta WHERE ta.user_id = auth.uid()));
REVOKE ALL ON public.tenant_alerts FROM anon, authenticated;
GRANT SELECT ON public.tenant_alerts TO authenticated;
GRANT UPDATE (read_at) ON public.tenant_alerts TO authenticated;

-- ── 3. Per-channel delivery ledger — attribution_forwards' shape (208) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.alert_deliveries (
  id            BIGSERIAL   PRIMARY KEY,
  alert_id      UUID        NOT NULL REFERENCES public.tenant_alerts(id) ON DELETE CASCADE,
  channel       TEXT        NOT NULL CHECK (channel IN ('email', 'slack', 'webhook', 'inbox')),
  status        TEXT        NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  attempts      INT         NOT NULL DEFAULT 0,
  http_status   INT,
  error         TEXT        CHECK (error IS NULL OR length(error) <= 500),
  next_retry_at TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'alert_deliveries_once_per_channel') THEN
    ALTER TABLE public.alert_deliveries
      ADD CONSTRAINT alert_deliveries_once_per_channel UNIQUE (alert_id, channel);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_alert_deliveries_retry
  ON public.alert_deliveries (next_retry_at) WHERE status = 'failed' AND next_retry_at IS NOT NULL;
ALTER TABLE public.alert_deliveries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS alert_deliveries_admin_read ON public.alert_deliveries;
CREATE POLICY alert_deliveries_admin_read ON public.alert_deliveries FOR SELECT TO authenticated
  USING (alert_id IN (SELECT a.id FROM public.tenant_alerts a
                       WHERE a.tenant_id IN (SELECT ta.tenant_id FROM public.tenant_admins ta WHERE ta.user_id = auth.uid())));
-- Writes: service_role (the sender) only.
REVOKE ALL ON public.alert_deliveries FROM anon, authenticated;
GRANT SELECT ON public.alert_deliveries TO authenticated;

-- Store one alert. NULL when the tenant turned the kind off (tenant_alert_prefs) or it was already alerted
-- within 24 h; otherwise the new alert's id. p_now is the clock (tests inject it).
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

-- Record one send attempt on the ledger. Failure → next_retry_at = now + min(2^attempts, 30) minutes, until
-- 8 attempts (then next_retry_at NULL: the row stays 'failed' for the owner to see, never retried again).
-- A 'sent' delivery is final: a later call for it changes nothing and returns no row.
CREATE OR REPLACE FUNCTION public.alert_delivery_record(
  p_alert_id    UUID,
  p_channel     TEXT,
  p_ok          BOOLEAN,
  p_http_status INT         DEFAULT NULL,
  p_error       TEXT        DEFAULT NULL,
  p_now         TIMESTAMPTZ DEFAULT now()
) RETURNS TABLE (status TEXT, attempts INT, next_retry_at TIMESTAMPTZ)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_cap_minutes  CONSTANT INT := 30;
  c_max_attempts CONSTANT INT := 8;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  INSERT INTO alert_deliveries AS d (alert_id, channel, status, attempts, http_status, error, next_retry_at, created_at, updated_at)
  VALUES (p_alert_id, p_channel, CASE WHEN p_ok THEN 'sent' ELSE 'failed' END, 1, p_http_status,
          CASE WHEN p_ok THEN NULL ELSE left(COALESCE(p_error, 'delivery failed'), 500) END,
          CASE WHEN p_ok THEN NULL ELSE p_now + make_interval(mins => least(2, c_cap_minutes)) END,
          p_now, p_now)
  ON CONFLICT (alert_id, channel) DO UPDATE
     SET status        = EXCLUDED.status,
         attempts      = d.attempts + 1,
         http_status   = EXCLUDED.http_status,
         error         = EXCLUDED.error,
         next_retry_at = CASE WHEN p_ok OR d.attempts + 1 >= c_max_attempts THEN NULL
                              ELSE p_now + make_interval(mins => least((2 ^ (d.attempts + 1))::INT, c_cap_minutes)) END,
         updated_at    = p_now
   WHERE d.status <> 'sent'
  RETURNING d.status, d.attempts, d.next_retry_at;
END;
$$;
REVOKE ALL ON FUNCTION public.alert_delivery_record(UUID, TEXT, BOOLEAN, INT, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.alert_delivery_record(UUID, TEXT, BOOLEAN, INT, TEXT, TIMESTAMPTZ) TO service_role;

-- Deliveries whose retry is due, with the alert they carry (the sender re-sends that one channel).
CREATE OR REPLACE FUNCTION public.alert_deliveries_due(p_now TIMESTAMPTZ DEFAULT now(), p_limit INT DEFAULT 200)
RETURNS TABLE (alert_id UUID, channel TEXT, attempts INT, tenant_id UUID, kind TEXT, severity TEXT, title TEXT,
               body TEXT, body_html TEXT, payload JSONB, created_at TIMESTAMPTZ)
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
  SELECT d.alert_id, d.channel, d.attempts, a.tenant_id, a.kind, a.severity, a.title, a.body, a.body_html,
         a.payload, a.created_at
    FROM alert_deliveries d JOIN tenant_alerts a ON a.id = d.alert_id
   WHERE d.status = 'failed' AND d.next_retry_at IS NOT NULL AND d.next_retry_at <= p_now
   ORDER BY d.next_retry_at
   LIMIT greatest(p_limit, 1);
END;
$$;
REVOKE ALL ON FUNCTION public.alert_deliveries_due(TIMESTAMPTZ, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.alert_deliveries_due(TIMESTAMPTZ, INT) TO service_role;

-- ── 4. What the attempt-alerts rules evaluate (D9) — read-only, service_role, clock injectable ─────────
-- A "failure" for the spike rule is a timeline row carrying an error class, except the outcomes that are not
-- breakage: a buyer leaving (abandoned / abandon_timeout / provider_abandoned) and paid_not_granted, which has
-- its own critical alert.
CREATE OR REPLACE FUNCTION public.attempt_event_is_failure(p_event TEXT, p_error_class TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_error_class IS NOT NULL
     AND p_event NOT IN ('abandoned', 'provider_abandoned', 'paid_not_granted')
     AND p_error_class NOT IN ('abandon_timeout', 'paid_not_granted')
$$;

-- Attempts the stitcher flagged paid-but-not-granted within the lookback — one critical alert each.
CREATE OR REPLACE FUNCTION public.attempt_alert_paid_not_granted(
  p_now              TIMESTAMPTZ DEFAULT now(),
  p_lookback_minutes INT DEFAULT 1440)
RETURNS TABLE (tenant_id UUID, attempt_id TEXT, provider TEXT, mode TEXT, plan TEXT, correlation TEXT,
               error_code TEXT, error_message TEXT, paid_at TIMESTAMPTZ, flagged_at TIMESTAMPTZ)
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
  SELECT a.tenant_id, a.attempt_id, a.provider::TEXT, a.mode::TEXT, a.plan::TEXT, a.correlation, a.error_code,
         a.error_message, a.paid_at, a.closed_at
    FROM checkout_attempts a
   WHERE a.state = 'paid_not_granted' AND a.attempt_id IS NOT NULL AND a.tenant_id IS NOT NULL
     AND a.closed_at > p_now - make_interval(mins => p_lookback_minutes) AND a.closed_at <= p_now
   ORDER BY a.closed_at;
END;
$$;

-- Webhook failures in the window: a signature refusal means a wrong provider secret (webhook_sig_fail,
-- grouped per provider code, e.g. stripe_signature), anything else a handler that could not process the
-- event (webhook_proc_fail, grouped per error class, e.g. stripe_webhook). group_key is the dedupe key.
CREATE OR REPLACE FUNCTION public.attempt_alert_webhook_failures(
  p_now            TIMESTAMPTZ DEFAULT now(),
  p_window_minutes INT DEFAULT 60)
RETURNS TABLE (tenant_id UUID, kind TEXT, group_key TEXT, error_class TEXT, error_codes TEXT[], failures INT,
               attempts INT, first_at TIMESTAMPTZ, last_at TIMESTAMPTZ, last_message TEXT, sample_attempt_ids TEXT[])
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
  WITH f AS (
    SELECT e.*,
           CASE WHEN e.error_class = 'signature' THEN 'webhook_sig_fail' ELSE 'webhook_proc_fail' END AS k,
           CASE WHEN e.error_class = 'signature' THEN COALESCE(e.error_code, 'signature') ELSE e.error_class END AS g
      FROM attempt_events e
     WHERE e.stage = 'webhook' AND e.error_class IS NOT NULL
       AND e.occurred_at > p_now - make_interval(mins => p_window_minutes) AND e.occurred_at <= p_now
  )
  SELECT f.tenant_id, f.k, f.g, min(f.error_class),
         array_remove(array_agg(DISTINCT f.error_code), NULL),
         count(*)::INT,
         count(DISTINCT f.attempt_id)::INT,
         min(f.occurred_at),
         max(f.occurred_at),
         (array_agg(f.error_message ORDER BY f.occurred_at DESC))[1],
         (array_agg(DISTINCT f.attempt_id))[1:5]
    FROM f
   GROUP BY f.tenant_id, f.k, f.g
   ORDER BY f.tenant_id, f.k, f.g;
END;
$$;

-- Failure-rate spike per (tenant, stage): failures in the last hour vs the trailing 7-day hourly rate before
-- it. Fires at >= p_multiplier x baseline AND >= p_min_failures (D9: 3x and 5).
CREATE OR REPLACE FUNCTION public.attempt_failure_spikes_current_hour(
  p_now          TIMESTAMPTZ DEFAULT now(),
  p_min_failures INT DEFAULT 5,
  p_multiplier   NUMERIC DEFAULT 3)
RETURNS TABLE (tenant_id UUID, stage TEXT, failures INT, baseline_failures INT, baseline_rate_per_hour NUMERIC,
               window_start TIMESTAMPTZ, window_end TIMESTAMPTZ, top_error_classes TEXT[])
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
  WITH cur AS (
    SELECT e.tenant_id, e.stage, count(*)::INT AS n,
           (array_agg(e.error_class ORDER BY e.occurred_at DESC))[1:3] AS classes
      FROM attempt_events e
     WHERE attempt_event_is_failure(e.event, e.error_class)
       AND e.occurred_at > p_now - interval '1 hour' AND e.occurred_at <= p_now
     GROUP BY e.tenant_id, e.stage
  ), base AS (
    SELECT e.tenant_id, e.stage, count(*)::INT AS n
      FROM attempt_events e
     WHERE attempt_event_is_failure(e.event, e.error_class)
       AND e.occurred_at > p_now - interval '1 hour' - interval '7 days' AND e.occurred_at <= p_now - interval '1 hour'
     GROUP BY e.tenant_id, e.stage
  )
  SELECT cur.tenant_id, cur.stage, cur.n, COALESCE(base.n, 0),
         round(COALESCE(base.n, 0) / 168.0, 4),
         p_now - interval '1 hour', p_now, cur.classes
    FROM cur LEFT JOIN base ON base.tenant_id = cur.tenant_id AND base.stage = cur.stage
   WHERE cur.n >= p_min_failures
     AND cur.n >= p_multiplier * (COALESCE(base.n, 0) / 168.0)
   ORDER BY cur.tenant_id, cur.stage;
END;
$$;

-- The hourly digests cover the previous whole UTC hour [h-1, h) of p_now, per tenant.
CREATE OR REPLACE FUNCTION public.attempt_hourly_outcome_summary(p_now TIMESTAMPTZ, p_state TEXT)
RETURNS TABLE (tenant_id UUID, count INT, window_start TIMESTAMPTZ, window_end TIMESTAMPTZ,
               by_provider JSONB, by_plan JSONB, top_codes JSONB)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_end   TIMESTAMPTZ := date_trunc('hour', p_now AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_start TIMESTAMPTZ := v_end - interval '1 hour';
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  WITH w AS (
    SELECT a.tenant_id, a.provider::TEXT AS provider, COALESCE(a.plan::TEXT, '(none)') AS plan,
           COALESCE(a.error_code, a.error_class) AS code
      FROM checkout_attempts a
     WHERE a.state = p_state AND a.tenant_id IS NOT NULL
       AND a.closed_at >= v_start AND a.closed_at < v_end
  )
  SELECT w.tenant_id, count(*)::INT, v_start, v_end,
         (SELECT jsonb_object_agg(x.provider, x.n) FROM (SELECT provider, count(*) n FROM w w2 WHERE w2.tenant_id = w.tenant_id GROUP BY provider) x),
         (SELECT jsonb_object_agg(x.plan, x.n) FROM (SELECT plan, count(*) n FROM w w2 WHERE w2.tenant_id = w.tenant_id GROUP BY plan) x),
         COALESCE((SELECT jsonb_object_agg(x.code, x.n) FROM (
             SELECT code, count(*) n FROM w w2 WHERE w2.tenant_id = w.tenant_id AND code IS NOT NULL
              GROUP BY code ORDER BY count(*) DESC, code LIMIT 5) x), '{}'::jsonb)
    FROM w
   GROUP BY w.tenant_id
   ORDER BY w.tenant_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.attempt_hourly_abandon_summary(p_now TIMESTAMPTZ DEFAULT now())
RETURNS TABLE (tenant_id UUID, count INT, window_start TIMESTAMPTZ, window_end TIMESTAMPTZ,
               by_provider JSONB, by_plan JSONB, top_codes JSONB)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM attempt_hourly_outcome_summary(p_now, 'abandoned')
$$;

CREATE OR REPLACE FUNCTION public.attempt_hourly_decline_summary(p_now TIMESTAMPTZ DEFAULT now())
RETURNS TABLE (tenant_id UUID, count INT, window_start TIMESTAMPTZ, window_end TIMESTAMPTZ,
               by_provider JSONB, by_plan JSONB, top_codes JSONB)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT * FROM attempt_hourly_outcome_summary(p_now, 'failed')
$$;

REVOKE ALL ON FUNCTION public.attempt_alert_paid_not_granted(TIMESTAMPTZ, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attempt_alert_webhook_failures(TIMESTAMPTZ, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attempt_failure_spikes_current_hour(TIMESTAMPTZ, INT, NUMERIC) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attempt_hourly_outcome_summary(TIMESTAMPTZ, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attempt_hourly_abandon_summary(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.attempt_hourly_decline_summary(TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attempt_alert_paid_not_granted(TIMESTAMPTZ, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.attempt_alert_webhook_failures(TIMESTAMPTZ, INT) TO service_role;
GRANT EXECUTE ON FUNCTION public.attempt_failure_spikes_current_hour(TIMESTAMPTZ, INT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.attempt_hourly_outcome_summary(TIMESTAMPTZ, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.attempt_hourly_abandon_summary(TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.attempt_hourly_decline_summary(TIMESTAMPTZ) TO service_role;

-- ── 5. Retention (D15) — alerts follow the tenant tier's analytics_retention_days, like attempts (210) ──
CREATE OR REPLACE FUNCTION public.tier_retention_purge_alerts() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM tenant_alerts a                     -- alert_deliveries go with them (ON DELETE CASCADE)
  USING tenants t
  LEFT JOIN tier_definitions td ON td.tier_name = t.plan
  WHERE a.tenant_id = t.id
    AND a.created_at < now() - make_interval(days => coalesce(td.analytics_retention_days, 90));
END; $$;
REVOKE ALL ON FUNCTION public.tier_retention_purge_alerts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tier_retention_purge_alerts() TO service_role;

-- ── 6. Scheduling ─────────────────────────────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_net;

-- POST functions/v1/<p_path> with the service-role key, both read from Vault at run time (187's pattern).
-- Without the vault entries it does nothing and returns NULL — a laptop or CI database never calls out.
CREATE OR REPLACE FUNCTION public.paycraft_function_post(p_path TEXT) RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_base TEXT;
  v_key  TEXT;
BEGIN
  IF p_path IS NULL OR p_path !~ '^[a-z0-9-]+(\?[A-Za-z0-9_=&-]*)?$' THEN
    RAISE EXCEPTION 'function_path_invalid: %', p_path USING ERRCODE = '22023';
  END IF;
  SELECT s.decrypted_secret INTO v_base FROM vault.decrypted_secrets s WHERE s.name = 'paycraft_functions_url';
  IF v_base IS NULL THEN
    SELECT regexp_replace(s.decrypted_secret, '/store-sync/?$', '') INTO v_base
      FROM vault.decrypted_secrets s WHERE s.name = 'paycraft_store_sync_url';
  END IF;
  SELECT s.decrypted_secret INTO v_key FROM vault.decrypted_secrets s WHERE s.name = 'paycraft_service_role_key';
  IF v_base IS NULL OR v_key IS NULL THEN
    RAISE NOTICE 'paycraft_function_post(%): vault entries paycraft_functions_url / paycraft_service_role_key absent — not called', p_path;
    RETURN NULL;
  END IF;
  RETURN net.http_post(
    url                  := rtrim(v_base, '/') || '/' || p_path,
    headers              := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_key),
    body                 := '{}'::jsonb,
    timeout_milliseconds := 120000);
END;
$$;
REVOKE ALL ON FUNCTION public.paycraft_function_post(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.paycraft_function_post(TEXT) TO service_role;

-- Phase-6 handoff: the attempt-insights cron calls this. Here it is a valid no-op (the schedule row exists
-- today for AC-8 and never fires a 404); 212 CREATE OR REPLACEs it with the real call.
CREATE OR REPLACE FUNCTION public.attempt_insights_dispatch()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE NOTICE 'attempt-insights not yet deployed (phase 6 replaces this body)';
END; $$;
REVOKE ALL ON FUNCTION public.attempt_insights_dispatch() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attempt_insights_dispatch() TO service_role;

-- Schedules in one block guarded on pg_cron — the shape of 037 / 165.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Hourly digest of non-critical attempt alerts (abandons + declines of the previous hour) + due retries.
    PERFORM cron.schedule('paycraft_attempt_alerts_digest', '13 * * * *',
      $cron$ SELECT paycraft_function_post('attempt-alerts?mode=digest'); $cron$);
    -- Stitching + the paid-not-granted detector (210) every 5 min, then the critical alert rules in the same
    -- run, so a paid_not_granted reaches the owner within D7's 10-minute window plus one tick.
    PERFORM cron.schedule('paycraft_attempt_stitch', '*/5 * * * *',
      $cron$ SELECT paycraft_function_post('attempt-stitch'); $cron$);
    -- tenant-alerts has had no schedule since 025 — closed here.
    PERFORM cron.schedule('paycraft_tenant_alerts', '17 * * * *',
      $cron$ SELECT paycraft_function_post('tenant-alerts'); $cron$);
    -- Weekly insights — attempt_insights_dispatch() is replaced by phase 6's migration 212.
    PERFORM cron.schedule('paycraft_attempt_insights', '0 9 * * 1',
      $cron$ SELECT attempt_insights_dispatch(); $cron$);
    -- Tier retention for attempts, timeline and alerts (D15) — nothing ran 210's purge before.
    PERFORM cron.schedule('paycraft_attempt_retention', '41 4 * * *',
      $cron$ SELECT tier_retention_purge_attempts(); SELECT tier_retention_purge_alerts(); $cron$);
  END IF;
END $$;
