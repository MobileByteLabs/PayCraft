-- 166 — teach the canary the difference between "this provider never delivered" and
--       "we only started recording WHICH provider delivered today", and delete the notifier
--       that duplicated a working one.
--
-- WHAT 165 GOT WRONG
-- Run against production immediately after deploy, 165 returned `never-seen` for ALL 31
-- (tenant, provider) pairs — including Stripe, which has 6 real subscriptions. The detector was
-- not wrong about the data; the data could not support the question:
--
--   webhook_logs: 13 rows all time, oldest 2026-05-14, and ZERO with a non-null tenant_id.
--
-- `billing_canary_webhook_verdicts()` joins `webhook_logs.tenant_id = tenant_providers.tenant_id`,
-- so with every tenant_id NULL the join matched nothing and every pair looked like a provider that
-- had never delivered. Nine tenant owners would have been told their payment provider was broken
-- when the truth was that attribution had only just been switched on.
--
-- ── THE SAME NULL BROKE SOMETHING THAT WAS ALREADY SHIPPED ───────────────────────────────────────
-- This is the more important half. `tenant-alerts` has had consecutive-webhook-failure email since
-- migration 025, and it reads:
--
--   .from("webhook_logs").select("status").eq("tenant_id", tenant.id)
--
-- With no row carrying a tenant_id that filter has matched nothing since May 2026, so the
-- webhook-failure alert nobody knew was broken has been silently dead for five months. The fix was
-- not another detector — it was `_shared/inbound-tenant.ts`, deployed 2026-10-22, which resolves
-- the tenant for every inbound event and sets `data.tenantId` before `logWebhookEvent` writes
-- (`subscription-handler.ts:72-77`). New rows carry attribution; the 13 historical ones cannot be
-- back-filled, because what they were missing is exactly the information needed to back-fill them.
--
-- ── 1. a verdict for "the instrument is younger than the question" ───────────────────────────────
-- `no-attributed-history` is a STATUS, never an alert, for the same reason `insufficient-baseline`
-- is: absence of evidence from a newly-installed instrument is not evidence of failure. It resolves
-- itself the first time any webhook lands with a tenant_id, so it needs no manual clearing and
-- cannot become a permanently-ignored row.
--
-- The guard is GLOBAL rather than per-provider on purpose. A per-provider test would still shout
-- `never-seen` at the eight quiet providers the moment the first Stripe webhook arrived, which is
-- the same false alarm one provider later.
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
  -- Has ANY webhook ever been recorded against a tenant? Until this is true, no per-(tenant,
  -- provider) claim about delivery can be made at all.
  attribution AS (
    SELECT EXISTS (SELECT 1 FROM webhook_logs WHERE tenant_id IS NOT NULL) AS live
  ),
  configured AS (
    SELECT tp.tenant_id, tp.provider, t.owner_email
      FROM tenant_providers tp
      JOIN tenants t ON t.id = tp.tenant_id
  ),
  gaps AS (
    SELECT wl.tenant_id, wl.provider,
           wl.created_at - lag(wl.created_at) OVER (
             PARTITION BY wl.tenant_id, wl.provider ORDER BY wl.created_at
           ) AS gap
      FROM webhook_logs wl
     WHERE wl.status = 'success'
       AND wl.tenant_id IS NOT NULL
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
           EXISTS (SELECT 1 FROM webhook_logs w2
                    WHERE w2.tenant_id = c.tenant_id AND w2.provider = c.provider)     AS ever_seen
      FROM configured c
      LEFT JOIN webhook_logs wl
             ON wl.tenant_id = c.tenant_id AND wl.provider = c.provider
     GROUP BY c.tenant_id, c.provider, c.owner_email
  )
  SELECT s.tenant_id, s.owner_email, s.provider,
         CASE
           WHEN s.failures_30d >= 3
            AND s.events_30d > 0
            AND s.failures_30d::NUMERIC / s.events_30d > 0.2            THEN 'failing'
           -- NEW: outranks never-seen. Without attribution every pair is unknowable, not broken.
           WHEN NOT (SELECT live FROM attribution)                      THEN 'no-attributed-history'
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
           WHEN NOT (SELECT live FROM attribution)
             THEN 'no webhook has EVER been recorded against a tenant — attribution landed '
                  || '2026-10-22 (inbound-tenant.ts); this resolves itself on the first '
                  || 'attributed delivery and is NOT a provider fault'
           WHEN NOT s.ever_seen
             THEN 'provider configured but has never delivered a webhook — verify the endpoint is '
                  || 'registered AND reachable'
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
  'Per-(tenant,provider) verdict on whether the purchase path is still delivering. Volume-guarded '
  'and attribution-aware: see migrations 165 and 166. READ surface for scripts/billing-canary.sh; '
  'notification lives in tenant-alerts, not here.';

-- ── 2. delete the notifier that notified nothing ─────────────────────────────────────────────────
-- 165 claimed its emit function "reuses tenant_alert_log + the tenant-alerts function's existing
-- email path". That was WRONG, and the error is worth recording rather than quietly patching:
-- `tenant-alerts` is a PUSH model. It computes each condition itself, sends, and writes to
-- `tenant_alert_log` only so `canSend()` can dedup. Nothing ever reads that table as a queue, so
-- 165's inserts produced audit rows no human or process would ever see — an alerting path that
-- looks wired and is inert, which is strictly worse than no path because it reads as covered.
--
-- It was also DUPLICATIVE. `tenant-alerts` has shipped consecutive-failure email since 025; the
-- `failing` verdict restates it. The right fix for that alert was the attribution NULL, now fixed —
-- not a parallel notifier that would have to be kept in agreement with it forever.
--
-- So the emit function and its cron job are removed. The verdicts function stays as a READ surface,
-- consumed by `scripts/billing-canary.sh` (exit 1 broken / 2 blind) which the hourly
-- `billing-canary.yml` workflow already surfaces as a CI failure or warning annotation. One
-- scheduled consumer, one notifier, no duplicate to drift.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'paycraft_billing_canary') THEN
      PERFORM cron.unschedule('paycraft_billing_canary');
    END IF;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.billing_canary_emit_alerts();
