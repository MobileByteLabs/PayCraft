-- Canary fixture (red-dispatch): all four schedules registered, but the weekly job still calls the stub.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('paycraft_attempt_alerts_digest', '13 * * * *',
      $cron$ SELECT paycraft_function_post('attempt-alerts?mode=digest'); $cron$);
    PERFORM cron.schedule('paycraft_attempt_stitch', '*/5 * * * *',
      $cron$ SELECT paycraft_function_post('attempt-stitch'); $cron$);
    PERFORM cron.schedule('paycraft_tenant_alerts', '17 * * * *',
      $cron$ SELECT paycraft_function_post('tenant-alerts'); $cron$);
    PERFORM cron.schedule('paycraft_attempt_insights', '0 9 * * 1',
      $cron$ SELECT attempt_insights_dispatch(); $cron$);
  END IF;
END $$;
-- 211's handoff stub: a valid no-op the weekly job calls until 212 replaces it.
CREATE OR REPLACE FUNCTION public.attempt_insights_dispatch()
RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RAISE NOTICE 'attempt-insights not yet deployed (phase 6 replaces this body)';
END; $$;
