-- 210 — payment attempts: one record per purchase attempt, from plan select through grant
-- (paycraft-attempt-observability, GOAL D1 / D3 / D5 / D6 / D7 / D15).
--
-- THE GAP
-- checkout_attempts (186 / 188 / 201) only ever recorded the END of an attempt that did not buy — an
-- 'abandoned' or 'payment_failed' row written by a webhook or the SDK. Nothing tied the plan the buyer
-- picked, the checkout the server opened, the provider's answer and the grant together, and a failure
-- carried at most a short store code. Money taken with no entitlement written was invisible.
--
-- WHAT THIS ADDS (additive — 186 / 188 / 201 writers keep working untouched)
--   · checkout_attempts becomes the attempt record: `attempt_id` (the SDK's id, carried to every
--     provider), a `state` machine, `correlation` exact | inferred (+ `match_rule`), the last failure as
--     `stage` / `error_class` / `error_code` / `error_message` (≤ 200 chars, D6), and the clock columns
--     `paid_at` / `granted_at` / `closed_at` / `updated_at`.
--       started → checkout_opened → provider_result → granted
--       started → provider_result                       (store lanes: no server-side checkout page)
--       started | checkout_opened → abandoned | failed
--       provider_result → failed | paid_not_granted
--       abandoned | failed → provider_result            (a late provider answer after a timeout)
--       abandoned | failed | paid_not_granted → granted (a late grant)
--       granted is terminal.
--     The guard trigger refuses every other edge, whoever writes.
--   · A row written by an OLD writer (no state in the INSERT) lands in the terminal state its outcome
--     already says — 'abandoned' / 'failed', closed at occurred_at — never an open attempt nobody closes,
--     and uncorrelated (correlation NULL) until attempt-stitch labels it 'inferred'.
--   · attempt_events — the append-only timeline. Every state an attempt enters is written by the table
--     itself (trigger), so no writer can skip it; functions append breadcrumbs and failures beside them.
--   · payment_attempts — the attempt-shaped read view (security_invoker: the caller's RLS decides).
--   · paywall_events.attempt_id — the SDK funnel joins the attempt.
--   · appstore_txn_attempt_map — Apple's original_transaction_id (and Play's purchase token) → the
--     attempt_id register-appstore / register-play-purchase saw, read back by the store notifications.
--   · tier_retention_purge_attempts() — closed attempts + timeline older than the tier's
--     analytics_retention_days (D15; the same cap paywall_events_purge uses).
--   · attempt_stitch_run(p_now, …) — paid-but-not-granted after 10 min (D7) and the abandon timeout,
--     with the clock a parameter so tests can inject it.
--   · tenants.nudge_* — the resume-nudge config served by /config as `nudge` (D10 / D12).
--
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE … IF NOT EXISTS / CREATE OR REPLACE / DROP … IF EXISTS /
-- ADD CONSTRAINT guarded by pg_constraint. Never drops a column, never narrows an existing CHECK.

-- ── 1. checkout_attempts → the attempt record ─────────────────────────────────────────────────────────
ALTER TABLE public.checkout_attempts ADD COLUMN IF NOT EXISTS attempt_id               TEXT;
ALTER TABLE public.checkout_attempts ADD COLUMN IF NOT EXISTS state                    TEXT;
ALTER TABLE public.checkout_attempts ADD COLUMN IF NOT EXISTS correlation              TEXT;
ALTER TABLE public.checkout_attempts ADD COLUMN IF NOT EXISTS match_rule               TEXT;
ALTER TABLE public.checkout_attempts ADD COLUMN IF NOT EXISTS stage                    TEXT;
ALTER TABLE public.checkout_attempts ADD COLUMN IF NOT EXISTS error_class              TEXT;
ALTER TABLE public.checkout_attempts ADD COLUMN IF NOT EXISTS error_code               TEXT;
ALTER TABLE public.checkout_attempts ADD COLUMN IF NOT EXISTS error_message            TEXT;
ALTER TABLE public.checkout_attempts ADD COLUMN IF NOT EXISTS paid_at                  TIMESTAMPTZ;
ALTER TABLE public.checkout_attempts ADD COLUMN IF NOT EXISTS granted_at               TIMESTAMPTZ;
ALTER TABLE public.checkout_attempts ADD COLUMN IF NOT EXISTS closed_at                TIMESTAMPTZ;
ALTER TABLE public.checkout_attempts ADD COLUMN IF NOT EXISTS updated_at               TIMESTAMPTZ;
ALTER TABLE public.checkout_attempts ADD COLUMN IF NOT EXISTS provider_subscription_id TEXT;

-- Rows written before 210 are finished attempts that did not buy: close them in the state their outcome says.
UPDATE public.checkout_attempts
SET state      = CASE outcome WHEN 'payment_failed' THEN 'failed' ELSE 'abandoned' END,
    closed_at  = coalesce(closed_at, occurred_at),
    updated_at = coalesce(updated_at, occurred_at)
WHERE state IS NULL;
UPDATE public.checkout_attempts SET updated_at = occurred_at WHERE updated_at IS NULL;

ALTER TABLE public.checkout_attempts ALTER COLUMN state SET NOT NULL;
ALTER TABLE public.checkout_attempts ALTER COLUMN updated_at SET DEFAULT now();
ALTER TABLE public.checkout_attempts ALTER COLUMN updated_at SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkout_attempts_state_check') THEN
    ALTER TABLE public.checkout_attempts ADD CONSTRAINT checkout_attempts_state_check
      CHECK (state IN ('started','checkout_opened','provider_result','granted','failed','abandoned','paid_not_granted'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkout_attempts_correlation_check') THEN
    ALTER TABLE public.checkout_attempts ADD CONSTRAINT checkout_attempts_correlation_check
      CHECK (correlation IS NULL OR correlation IN ('exact','inferred'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkout_attempts_attempt_id_check') THEN
    ALTER TABLE public.checkout_attempts ADD CONSTRAINT checkout_attempts_attempt_id_check
      CHECK (attempt_id IS NULL OR length(attempt_id) BETWEEN 1 AND 160);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'checkout_attempts_failure_check') THEN
    ALTER TABLE public.checkout_attempts ADD CONSTRAINT checkout_attempts_failure_check
      CHECK ((stage IS NULL OR stage IN ('sdk','server','provider','webhook','entitlement'))
         AND (match_rule IS NULL OR length(match_rule) <= 48)
         AND (error_class IS NULL OR length(error_class) <= 48)
         AND (error_code IS NULL OR length(error_code) <= 48)
         AND (error_message IS NULL OR length(error_message) <= 200));
  END IF;
END $$;

-- A full (non-partial) unique index: NULLs stay distinct, and PostgREST's on_conflict=attempt_id can name it.
CREATE UNIQUE INDEX IF NOT EXISTS checkout_attempts_attempt_id_uq ON public.checkout_attempts (attempt_id);
CREATE INDEX IF NOT EXISTS checkout_attempts_open_state ON public.checkout_attempts (state, occurred_at)
  WHERE state IN ('started', 'checkout_opened', 'provider_result');
CREATE INDEX IF NOT EXISTS checkout_attempts_unstitched ON public.checkout_attempts (occurred_at)
  WHERE attempt_id IS NULL AND correlation IS NULL AND match_rule IS NULL;
CREATE INDEX IF NOT EXISTS checkout_attempts_tenant_updated ON public.checkout_attempts (tenant_id, updated_at DESC);

-- ── 2. attempt_events — the append-only timeline ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attempt_events (
  id            BIGSERIAL   PRIMARY KEY,
  attempt_id    TEXT        NOT NULL CHECK (length(attempt_id) BETWEEN 1 AND 160),
  tenant_id     UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  stage         TEXT        NOT NULL CHECK (stage IN ('sdk','server','provider','webhook','entitlement')),
  event         TEXT        NOT NULL CHECK (length(event) BETWEEN 1 AND 64),
  error_class   TEXT        CHECK (error_class IS NULL OR length(error_class) <= 48),
  error_code    TEXT        CHECK (error_code IS NULL OR length(error_code) <= 48),
  error_message TEXT        CHECK (error_message IS NULL OR length(error_message) <= 200),
  occurred_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS attempt_events_attempt ON public.attempt_events (attempt_id, occurred_at);
CREATE INDEX IF NOT EXISTS attempt_events_tenant  ON public.attempt_events (tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS attempt_events_tenant_stage ON public.attempt_events (tenant_id, stage, occurred_at DESC)
  WHERE error_class IS NOT NULL;

ALTER TABLE public.attempt_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attempt_events_admin_select ON public.attempt_events;
CREATE POLICY attempt_events_admin_select ON public.attempt_events FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT ta.tenant_id FROM public.tenant_admins ta WHERE ta.user_id = auth.uid()));
-- No INSERT / UPDATE / DELETE policy: only service_role (the edge functions) and the table's own triggers write.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.attempt_events FROM anon, authenticated;

-- Append-only: a timeline row is never rewritten, by anyone. Deletes stay possible for the tier purge and
-- the tenant cascade only (RLS denies them to every client role).
CREATE OR REPLACE FUNCTION public.attempt_events_append_only() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'attempt_events_append_only: timeline row % cannot be rewritten', OLD.id
    USING ERRCODE = 'check_violation';
END; $$;
DROP TRIGGER IF EXISTS attempt_events_no_update ON public.attempt_events;
CREATE TRIGGER attempt_events_no_update BEFORE UPDATE ON public.attempt_events
  FOR EACH ROW EXECUTE FUNCTION public.attempt_events_append_only();

-- ── 3. State machine on checkout_attempts ─────────────────────────────────────────────────────────────
-- Fills what an old writer leaves out, so a 186 / 188 / 201 INSERT lands as a closed attempt.
CREATE OR REPLACE FUNCTION public.attempt_insert_defaults() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IS NULL THEN
    NEW.state     := CASE NEW.outcome WHEN 'payment_failed' THEN 'failed' ELSE 'abandoned' END;
    NEW.closed_at := coalesce(NEW.closed_at, NEW.occurred_at, now());
  END IF;
  IF NEW.correlation IS NULL AND NEW.attempt_id IS NOT NULL THEN
    NEW.correlation := 'exact';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS checkout_attempts_insert_defaults ON public.checkout_attempts;
CREATE TRIGGER checkout_attempts_insert_defaults BEFORE INSERT ON public.checkout_attempts
  FOR EACH ROW EXECUTE FUNCTION public.attempt_insert_defaults();

-- Refuses every edge the machine does not declare. granted is terminal; a late grant is accepted.
CREATE OR REPLACE FUNCTION public.attempt_transition_guard() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.state IS DISTINCT FROM OLD.state THEN
    IF OLD.state = 'granted' THEN
      RAISE EXCEPTION 'attempt_terminal: granted is terminal (attempt_id=%)', OLD.attempt_id
        USING ERRCODE = 'check_violation';
    END IF;
    IF NOT (
         (OLD.state = 'started'          AND NEW.state IN ('checkout_opened','provider_result','abandoned','failed'))
      OR (OLD.state = 'checkout_opened'  AND NEW.state IN ('provider_result','abandoned','failed'))
      OR (OLD.state = 'provider_result'  AND NEW.state IN ('granted','failed','paid_not_granted'))
      OR (OLD.state IN ('abandoned','failed') AND NEW.state = 'provider_result')
      OR (OLD.state IN ('abandoned','failed','paid_not_granted') AND NEW.state = 'granted')
    ) THEN
      RAISE EXCEPTION 'attempt_illegal_transition: % → % (attempt_id=%)', OLD.state, NEW.state, OLD.attempt_id
        USING ERRCODE = 'check_violation';
    END IF;
    -- A grant settles the attempt: the row stops carrying the failure it recovered from (the timeline
    -- keeps that failure as history).
    IF NEW.state = 'granted' THEN
      NEW.stage := NULL; NEW.error_class := NULL; NEW.error_code := NULL; NEW.error_message := NULL;
    END IF;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS checkout_attempts_transition_guard ON public.checkout_attempts;
CREATE TRIGGER checkout_attempts_transition_guard
  BEFORE UPDATE ON public.checkout_attempts
  FOR EACH ROW EXECUTE FUNCTION public.attempt_transition_guard();

-- The stage a state belongs to when the writer recorded no failure stage of its own.
CREATE OR REPLACE FUNCTION public.attempt_state_stage(p_state TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE p_state
    WHEN 'started'          THEN 'sdk'
    WHEN 'checkout_opened'  THEN 'server'
    WHEN 'provider_result'  THEN 'provider'
    WHEN 'granted'          THEN 'entitlement'
    WHEN 'paid_not_granted' THEN 'entitlement'
    WHEN 'abandoned'        THEN 'sdk'
    ELSE 'server'
  END
$$;

-- Every state an attempt enters lands on its timeline — written here so no writer can skip it.
-- A failure state carries the failure the writer recorded on the row (stage / class / code / message).
CREATE OR REPLACE FUNCTION public.attempt_state_to_timeline() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_failure BOOLEAN := NEW.state IN ('failed', 'paid_not_granted', 'abandoned');
BEGIN
  IF NEW.attempt_id IS NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.state IS NOT DISTINCT FROM OLD.state THEN RETURN NEW; END IF;
  INSERT INTO attempt_events (attempt_id, tenant_id, stage, event, error_class, error_code, error_message)
  VALUES (NEW.attempt_id, NEW.tenant_id,
          CASE WHEN v_failure AND NEW.stage IS NOT NULL THEN NEW.stage ELSE attempt_state_stage(NEW.state) END,
          NEW.state,
          CASE WHEN v_failure THEN NEW.error_class END,
          CASE WHEN v_failure THEN NEW.error_code END,
          CASE WHEN v_failure THEN NEW.error_message END);
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS checkout_attempts_state_timeline ON public.checkout_attempts;
CREATE TRIGGER checkout_attempts_state_timeline
  AFTER INSERT OR UPDATE OF state ON public.checkout_attempts
  FOR EACH ROW EXECUTE FUNCTION public.attempt_state_to_timeline();

-- ── 4. payment_attempts — the attempt-shaped read view ────────────────────────────────────────────────
-- user_ref is the same hash the events function stores on paywall_events (sha256(tenant_id || ':' ||
-- lower(email))), so the dashboard joins a buyer's attempts to their funnel without ever reading an email.
CREATE OR REPLACE VIEW public.payment_attempts WITH (security_invoker = true) AS
SELECT a.id,
       a.tenant_id,
       a.attempt_id,
       a.provider,
       a.mode,
       a.plan,
       a.state,
       a.correlation,
       a.match_rule,
       a.stage,
       a.error_class,
       a.error_code,
       a.error_message,
       a.provider_session_id,
       a.provider_subscription_id,
       CASE WHEN a.email IS NOT NULL
            THEN encode(extensions.digest(a.tenant_id::text || ':' || lower(a.email), 'sha256'), 'hex') END AS user_ref,
       a.occurred_at AS started_at,
       a.paid_at,
       a.granted_at,
       a.closed_at,
       a.updated_at
FROM public.checkout_attempts a;
GRANT SELECT ON public.payment_attempts TO authenticated, service_role;

-- The customer list (188's view, unchanged otherwise) keeps listing only attempts that ENDED without a
-- purchase. checkout-initiate now opens an attempt for every checkout, so an attempt still in flight (or
-- one that was granted) must not appear as someone who "tried and did not finish". A paid-but-not-granted
-- buyer is listed — support has to reach them first.
CREATE OR REPLACE VIEW public.tenant_customers_view WITH (security_invoker = true) AS
SELECT s.tenant_id, s.mode, 'subscription'::text AS source, s.id::text AS row_id,
       s.email, NULL::text AS app_user_id, s.plan, s.provider, s.status,
       s.current_period_end AS period_end, s.created_at AS started_at, s.updated_at
FROM subscriptions s
UNION ALL
SELECT * FROM (
    SELECT DISTINCT ON (e.tenant_id, e.app_user_id, e.provider)
           e.tenant_id, CASE WHEN e.is_sandbox THEN 'test' ELSE 'live' END, 'store'::text, e.id::text,
           CASE WHEN e.app_user_id LIKE '%@%' THEN e.app_user_id END, e.app_user_id, e.product_id, e.provider,
           e.canonical_state, e.expires_at, MIN(e.updated_at) OVER (PARTITION BY e.tenant_id, e.app_user_id, e.provider),
           e.updated_at
    FROM entitlement_records e
    WHERE e.provider IN ('google_play', 'app_store')
    ORDER BY e.tenant_id, e.app_user_id, e.provider, e.latest_event_ts DESC
) store
UNION ALL
SELECT * FROM (
    SELECT DISTINCT ON (a.tenant_id, a.mode, lower(coalesce(a.email, a.app_user_id)))
           a.tenant_id, a.mode, 'attempt'::text, a.id::text, a.email, a.app_user_id, a.plan, a.provider,
           CASE a.state WHEN 'failed' THEN 'payment_failed' WHEN 'abandoned' THEN 'abandoned' ELSE a.state END,
           NULL::timestamptz, a.occurred_at, a.occurred_at
    FROM checkout_attempts a
    WHERE a.state IN ('abandoned', 'failed', 'paid_not_granted')
      AND NOT EXISTS (
        SELECT 1 FROM subscriptions s
        WHERE s.tenant_id = a.tenant_id AND s.mode = a.mode AND a.email IS NOT NULL AND lower(s.email) = a.email)
      AND NOT EXISTS (
        SELECT 1 FROM entitlement_records e
        WHERE e.tenant_id = a.tenant_id AND e.provider IN ('google_play', 'app_store')
          AND lower(e.app_user_id) IN (lower(a.app_user_id), a.email))
    ORDER BY a.tenant_id, a.mode, lower(coalesce(a.email, a.app_user_id)), a.occurred_at DESC
) attempts;
GRANT SELECT ON public.tenant_customers_view TO authenticated, service_role;

-- ── 5. Correlation carriers ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.paywall_events ADD COLUMN IF NOT EXISTS attempt_id TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'paywall_events_attempt_id_check') THEN
    ALTER TABLE public.paywall_events ADD CONSTRAINT paywall_events_attempt_id_check
      CHECK (attempt_id IS NULL OR length(attempt_id) BETWEEN 1 AND 100);
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS paywall_events_attempt ON public.paywall_events (attempt_id) WHERE attempt_id IS NOT NULL;

-- An Apple original_transaction_id (or `play:<purchase token>`) → the attempt_id the SDK's register call
-- carried. App Store notifications have no field the SDK can set for the attempt (appAccountToken is the
-- user), so the notification reads the id back from here.
CREATE TABLE IF NOT EXISTS public.appstore_txn_attempt_map (
  original_transaction_id TEXT        PRIMARY KEY CHECK (length(original_transaction_id) BETWEEN 1 AND 512),
  tenant_id               UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  attempt_id              TEXT        NOT NULL CHECK (length(attempt_id) BETWEEN 1 AND 160),
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS appstore_txn_attempt_map_attempt ON public.appstore_txn_attempt_map (attempt_id);
ALTER TABLE public.appstore_txn_attempt_map ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.appstore_txn_attempt_map FROM anon, authenticated;

-- ── 6. Retention (D15) ────────────────────────────────────────────────────────────────────────────────
-- Closed attempts and timeline rows older than the tenant tier's analytics_retention_days (90 when the
-- tier is unknown — the paywall_events_purge rule). Open attempts are left to the stitcher to close.
CREATE OR REPLACE FUNCTION public.tier_retention_purge_attempts() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM checkout_attempts a
  USING tenants t
  LEFT JOIN tier_definitions td ON td.tier_name = t.plan
  WHERE a.tenant_id = t.id
    AND a.closed_at IS NOT NULL
    AND a.closed_at < now() - make_interval(days => coalesce(td.analytics_retention_days, 90));

  DELETE FROM attempt_events e
  USING tenants t
  LEFT JOIN tier_definitions td ON td.tier_name = t.plan
  WHERE e.tenant_id = t.id
    AND e.occurred_at < now() - make_interval(days => coalesce(td.analytics_retention_days, 90));

  DELETE FROM appstore_txn_attempt_map m
  USING tenants t
  LEFT JOIN tier_definitions td ON td.tier_name = t.plan
  WHERE m.tenant_id = t.id
    AND m.created_at < now() - make_interval(days => coalesce(td.analytics_retention_days, 90));
END; $$;
REVOKE ALL ON FUNCTION public.tier_retention_purge_attempts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tier_retention_purge_attempts() TO service_role;

-- ── 7. Paid-not-granted detector + abandon timeout (called by attempt-stitch; clock injectable) ───────
CREATE OR REPLACE FUNCTION public.attempt_stitch_run(
  p_now                 TIMESTAMPTZ DEFAULT now(),
  p_paid_cutoff_minutes INT DEFAULT 10,
  p_abandon_minutes     INT DEFAULT 120)
RETURNS TABLE (paid_not_granted INT, abandoned INT)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_png INT;
  v_abn INT;
BEGIN
  -- The provider says paid and the reconciler never wrote granted_at (D7): the costliest silent failure.
  UPDATE checkout_attempts
  SET state = 'paid_not_granted', closed_at = p_now,
      stage = 'entitlement', error_class = 'paid_not_granted', error_code = 'no_grant_' || p_paid_cutoff_minutes || 'm',
      error_message = 'provider reported paid; no entitlement within ' || p_paid_cutoff_minutes || ' minutes'
  WHERE state = 'provider_result' AND paid_at IS NOT NULL AND granted_at IS NULL
    AND paid_at < p_now - make_interval(mins => p_paid_cutoff_minutes);
  GET DIAGNOSTICS v_png = ROW_COUNT;

  -- An attempt opened (or a checkout page served) and nothing came back: the buyer left.
  UPDATE checkout_attempts
  SET state = 'abandoned', outcome = 'abandoned', closed_at = p_now,
      stage = 'server', error_class = 'abandon_timeout', error_code = 'no_result_' || p_abandon_minutes || 'm',
      error_message = NULL
  WHERE state IN ('started', 'checkout_opened')
    AND occurred_at < p_now - make_interval(mins => p_abandon_minutes);
  GET DIAGNOSTICS v_abn = ROW_COUNT;

  RETURN QUERY SELECT v_png, v_abn;
END; $$;
REVOKE ALL ON FUNCTION public.attempt_stitch_run(TIMESTAMPTZ, INT, INT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.attempt_stitch_run(TIMESTAMPTZ, INT, INT) TO service_role;

-- ── 8. Resume nudge config (D10 / D12) ────────────────────────────────────────────────────────────────
-- One local "resume" notification after a checkout abandon / payment failure, scheduled by the SDK. The delay
-- and the copy are the tenant's, served by /config as `nudge {enabled, delay_seconds, title, body}`; NULL copy
-- means the SDK's own default strings. 60 s is the floor (the device test sets it through this row, never
-- through an SDK constant); 7 days the ceiling (the SDK sends at most one nudge per 7 days anyway).
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS nudge_enabled       BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS nudge_delay_seconds INT     NOT NULL DEFAULT 7200;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS nudge_title         TEXT;
ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS nudge_body          TEXT;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_nudge_delay_bounds') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_nudge_delay_bounds
      CHECK (nudge_delay_seconds BETWEEN 60 AND 604800);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_nudge_copy_length') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_nudge_copy_length
      CHECK ((nudge_title IS NULL OR length(nudge_title) BETWEEN 1 AND 80)
         AND (nudge_body IS NULL OR length(nudge_body) BETWEEN 1 AND 240));
  END IF;
END $$;
