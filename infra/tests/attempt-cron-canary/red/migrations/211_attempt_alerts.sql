-- Canary fixture (red): the weekly insights schedule was never registered — the gate must name it.
-- A commented-out schedule does not count: only a live cron.schedule call registers a job.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('paycraft_attempt_alerts_digest', '13 * * * *',
      $cron$ SELECT paycraft_function_post('attempt-alerts?mode=digest'); $cron$);
    PERFORM cron.schedule('paycraft_attempt_stitch', '*/5 * * * *',
      $cron$ SELECT paycraft_function_post('attempt-stitch'); $cron$);
    PERFORM cron.schedule('paycraft_tenant_alerts', '17 * * * *',
      $cron$ SELECT paycraft_function_post('tenant-alerts'); $cron$);
    -- PERFORM cron.schedule('paycraft_attempt_insights', '0 9 * * 1', $cron$ SELECT attempt_insights_dispatch(); $cron$);
  END IF;
END $$;
