-- 187: run functions/v1/store-sync every day (Google Play re-check + voided purchases, App Store
-- notification-history backfill — see supabase/functions/store-sync).
--
-- pg_cron fires; pg_net makes the HTTP call. The URL and the service-role key the function demands are
-- read from Supabase Vault at run time, so neither lives in this file. A database WITHOUT those two
-- vault entries (local, CI, a fresh self-host) schedules a job that does nothing — it can never call a
-- production URL from a laptop. Provision them once, in production:
--
--   select vault.create_secret('https://<ref>.supabase.co/functions/v1/store-sync', 'paycraft_store_sync_url');
--   select vault.create_secret('<service-role key>', 'paycraft_service_role_key');
--
-- Idempotent: CREATE EXTENSION IF NOT EXISTS; cron.schedule replaces a job of the same name.

CREATE EXTENSION IF NOT EXISTS pg_net;

SELECT cron.schedule(
    'paycraft_store_sync',
    '17 3 * * *',
    $job$
    SELECT net.http_post(
        url     := (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'paycraft_store_sync_url'),
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'paycraft_service_role_key')),
        body    := '{}'::jsonb,
        timeout_milliseconds := 120000)
    WHERE EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'paycraft_store_sync_url')
      AND EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'paycraft_service_role_key');
    $job$
);
