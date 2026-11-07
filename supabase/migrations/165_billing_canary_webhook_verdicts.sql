-- 165 — continuous verdicts on whether each provider's purchase path is still working.
--
-- WHAT THIS IS FOR
-- `webhook-health` answers "is this tenant's config shaped correctly" when someone asks it.
-- Nothing answers "has a provider stopped delivering purchases" unless someone asks, and nobody
-- asks until a customer complains. That is the gap this closes: a scheduled verdict per
-- (tenant, provider), emitted as an alert through the existing `tenant_alert_log` path.
--
-- ── WHY THE THRESHOLDS LOOK TIMID ─────────────────────────────────────────────────────────────
-- Measured on production 2026-10-22: 9 tenants, 6 subscriptions total, 4 active, and every one of
-- them Stripe. Play, App Store and Razorpay are configured on 9/9/4 tenants and have produced
-- ZERO subscriptions.
--
-- At that volume the obvious detector — "no webhook in 6 hours" — is noise, not signal. A healthy
-- tenant with one subscriber legitimately sees no webhook for a month. Shipping that detector
-- would produce a daily false alarm, and a daily false alarm is worse than no detector: it trains
-- the operator to ignore the one real alert when it comes.
--
-- So each verdict is gated on having enough history to mean anything, and a thin baseline is
-- reported as `insufficient-baseline` — a STATUS, never an alert. This is deliberately the honest
-- shape rather than the impressive one. As volume grows the same thresholds start firing on their
-- own, because they are relative to each provider's own observed cadence rather than a fixed
-- interval someone guessed.
--
-- ── THE FOUR VERDICTS, AND WHY EACH EARNS ITS PLACE ───────────────────────────────────────────
--   failing                 — failures are volume-INDEPENDENT, so this is the one detector that
--                             works at 4 subscriptions. A signature mismatch or a rotated key
--                             fails every delivery, and 3 failures at >20% is already a broken
--                             purchase path.
--   silent                  — needs history to judge. Fires at 3x the provider's own longest
--                             observed gap, floored at 24h so a chatty provider cannot produce a
--                             hair-trigger.
--   never-seen              — a provider CONFIGURED but with no event EVER. At this volume that
--                             is the single most likely real defect: a webhook registered in the
--                             dashboard that was never reachable, which looks identical to "no
--                             sales yet" until someone checks. Alerted once, then deduped.
--   insufficient-baseline   — 1..4 events. Not an alert. Says "cannot judge yet" out loud instead
--                             of silently passing, which is how a dead provider hides.
--
-- Idempotent: CREATE OR REPLACE throughout; the cron schedule is guarded on pg_cron's presence
-- exactly as 037 does.

-- ── 1. the verdicts ──────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.billing_canary_webhook_verdicts()
RETURNS TABLE (
  tenant_id        UUID,
  owner_email      TEXT,
  provider         TEXT,
  verdict          TEXT,
  events_30d       INT,
  failures_30d     INT,
  last_success_at  TIMESTAMPTZ,
  longest_gap      INTERVAL,
  detail           TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  WITH
  -- Every (tenant, provider) a purchase could legitimately arrive on. Driven from
  -- tenant_providers rather than from webhook_logs, because a provider that has NEVER delivered
  -- is precisely the case worth catching — and it has no rows in webhook_logs to be found by.
  configured AS (
    SELECT tp.tenant_id, tp.provider, t.owner_email
      FROM tenant_providers tp
      JOIN tenants t ON t.id = tp.tenant_id
  ),
  -- Gaps between consecutive SUCCESSFUL deliveries, per (tenant, provider). Successes only:
  -- a run of failures must not be mistaken for healthy cadence.
  gaps AS (
    SELECT wl.tenant_id, wl.provider,
           wl.created_at - lag(wl.created_at) OVER (
             PARTITION BY wl.tenant_id, wl.provider ORDER BY wl.created_at
           ) AS gap
      FROM webhook_logs wl
     WHERE wl.status = 'success'
       AND wl.created_at > now() - INTERVAL '30 days'
  ),
  stats AS (
    SELECT c.tenant_id, c.provider, c.owner_email,
           count(wl.id) FILTER (
             WHERE wl.created_at > now() - INTERVAL '30 days')::INT                    AS events_30d,
           count(wl.id) FILTER (
             WHERE wl.status = 'failed'
               AND wl.created_at > now() - INTERVAL '30 days')::INT                    AS failures_30d,
           max(wl.created_at) FILTER (WHERE wl.status = 'success')                     AS last_success_at,
           (SELECT max(g.gap) FROM gaps g
             WHERE g.tenant_id = c.tenant_id AND g.provider = c.provider)              AS longest_gap,
           -- Distinguishes "never delivered" from "quiet lately". EVER, not 30d: a provider that
           -- worked a year ago is a different problem from one that never worked at all.
           EXISTS (SELECT 1 FROM webhook_logs w2
                    WHERE w2.tenant_id = c.tenant_id AND w2.provider = c.provider)     AS ever_seen
      FROM configured c
      LEFT JOIN webhook_logs wl
             ON wl.tenant_id = c.tenant_id AND wl.provider = c.provider
     GROUP BY c.tenant_id, c.provider, c.owner_email
  )
  SELECT s.tenant_id, s.owner_email, s.provider,
         CASE
           -- Order matters: a FAILING provider is also technically silent, and the failure is the
           -- actionable half (it names a cause), so it must win.
           WHEN s.failures_30d >= 3
            AND s.events_30d > 0
            AND s.failures_30d::NUMERIC / s.events_30d > 0.2            THEN 'failing'
           WHEN NOT s.ever_seen                                          THEN 'never-seen'
           WHEN s.events_30d >= 5
            AND s.last_success_at IS NOT NULL
            AND now() - s.last_success_at >
                GREATEST(COALESCE(s.longest_gap, INTERVAL '0') * 3,
                         INTERVAL '24 hours')                            THEN 'silent'
           WHEN s.events_30d BETWEEN 1 AND 4                             THEN 'insufficient-baseline'
           WHEN s.events_30d = 0 AND s.ever_seen                         THEN 'insufficient-baseline'
           ELSE 'ok'
         END                                                             AS verdict,
         s.events_30d, s.failures_30d, s.last_success_at, s.longest_gap,
         CASE
           WHEN s.failures_30d >= 3 AND s.events_30d > 0
            AND s.failures_30d::NUMERIC / s.events_30d > 0.2
             THEN s.failures_30d || '/' || s.events_30d || ' deliveries failed in 30d'
           WHEN NOT s.ever_seen
             THEN 'provider configured but has never delivered a webhook — verify the endpoint is '
                  || 'registered AND reachable (this looks identical to "no sales yet")'
           WHEN s.events_30d >= 5 AND s.last_success_at IS NOT NULL
            AND now() - s.last_success_at >
                GREATEST(COALESCE(s.longest_gap, INTERVAL '0') * 3, INTERVAL '24 hours')
             THEN 'no successful delivery for ' || (now() - s.last_success_at)::TEXT
                  || ' (3x its own longest 30d gap of ' || COALESCE(s.longest_gap::TEXT, 'n/a') || ')'
           WHEN s.events_30d BETWEEN 1 AND 4 OR (s.events_30d = 0 AND s.ever_seen)
             THEN 'only ' || s.events_30d || ' event(s) in 30d — too thin to judge silence; '
                  || 'failure detection still active'
           ELSE 'healthy'
         END                                                             AS detail
    FROM stats s;
$$;

COMMENT ON FUNCTION public.billing_canary_webhook_verdicts() IS
  'Per-(tenant,provider) verdict on whether the purchase path is still delivering. '
  'Volume-guarded: see migration 165 for why the thresholds are relative, not fixed.';

-- ── 2. emit, with dedup ──────────────────────────────────────────────────────────────────────────
-- Reuses tenant_alert_log + the tenant-alerts function's existing email path rather than adding a
-- second notification channel. `idx_alert_log_dedup` was built for exactly this query shape.
CREATE OR REPLACE FUNCTION public.billing_canary_emit_alerts()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alerted INT := 0;
  r RECORD;
  v_type TEXT;
BEGIN
  FOR r IN
    SELECT * FROM billing_canary_webhook_verdicts()
     WHERE verdict IN ('failing', 'silent', 'never-seen')
  LOOP
    v_type := 'canary_' || replace(r.verdict, '-', '_');

    -- One alert per (tenant, provider-class) per 24h. Without this a persistently broken provider
    -- emails the owner on every cron tick until they fix it, which is how an alert channel gets
    -- muted — and a muted channel is indistinguishable from no channel.
    CONTINUE WHEN EXISTS (
      SELECT 1 FROM tenant_alert_log
       WHERE tenant_id = r.tenant_id
         AND alert_type = v_type
         AND sent_at > now() - INTERVAL '24 hours'
    );

    INSERT INTO tenant_alert_log(tenant_id, alert_type, recipient)
    VALUES (r.tenant_id, v_type, r.owner_email);
    v_alerted := v_alerted + 1;

    RAISE NOTICE 'billing canary: % % -> % (%)', r.tenant_id, r.provider, r.verdict, r.detail;
  END LOOP;
  RETURN v_alerted;
END;
$$;

-- ── 3. schedule ──────────────────────────────────────────────────────────────────────────────────
-- Hourly, not daily. The daily cadence in 037 suits a grace-period sweep, where a day of latency
-- changes nothing. A broken purchase path costs money every hour it goes unnoticed, and the dedup
-- above means an hourly check still sends at most one email a day.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('paycraft_billing_canary', '7 * * * *',
      $cron$ SELECT billing_canary_emit_alerts(); $cron$);
  END IF;
END $$;
