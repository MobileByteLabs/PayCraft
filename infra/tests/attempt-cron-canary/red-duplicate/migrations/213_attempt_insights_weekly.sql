-- Canary fixture (red-duplicate): a second, hand-added weekly insights schedule beside 211's — every tenant would
-- be summarised and billed twice a week. The gate must refuse it.
SELECT cron.schedule('attempt-insights-weekly', '0 7 * * 0', $cron$ SELECT attempt_insights_dispatch(); $cron$);
