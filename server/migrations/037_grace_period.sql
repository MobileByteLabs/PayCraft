-- 037_grace_period.sql — pg_cron daily check for expired grace + audit log retention
-- Optional migration — requires pg_cron extension. Skipped silently if unavailable.
BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_cron') THEN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
  ELSE
    RAISE NOTICE 'pg_cron not available — skipping cron job creation. Run grace-check manually.';
  END IF;
END $$;

-- Helper for the cron body (always available so manual cron callers can use it too).
CREATE OR REPLACE FUNCTION grace_check_emit_alerts()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alerted INT := 0;
  r RECORD;
BEGIN
  FOR r IN
    SELECT t.id AS tenant_id,
           t.owner_email,
           scv.active_count,
           td.max_active_subscribers,
           t.grace_started_at
      FROM tenants t
      JOIN tier_definitions td ON td.tier_name = t.plan
      JOIN tenant_subscriber_count_view scv ON scv.tenant_id = t.id
     WHERE t.grace_started_at IS NOT NULL
       AND t.grace_started_at < now() - INTERVAL '7 days'
       AND td.max_active_subscribers IS NOT NULL
       AND scv.active_count >= td.max_active_subscribers
  LOOP
    INSERT INTO tenant_alert_log(tenant_id, alert_type, recipient)
    VALUES (r.tenant_id, 'grace_expired', r.owner_email);
    v_alerted := v_alerted + 1;
  END LOOP;
  RETURN v_alerted;
END;
$$;

-- Schedule daily 06:00 UTC if pg_cron is present.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('paycraft_grace_check', '0 6 * * *',
      $cron$ SELECT grace_check_emit_alerts(); $cron$);
    PERFORM cron.schedule('paycraft_audit_purge', '30 6 * * *',
      $cron$ SELECT tenant_audit_log_purge_stale(); $cron$);
  END IF;
END $$;

COMMIT;
