-- 217 — paid plans keep analytics forever (paycraft-ga4-analytics-audit, owner request 2026-11-26).
--
-- The Analytics page offers 7 / 30 / 90 days and "All time"; a plan's analytics_retention_days caps the range AND is
-- what the nightly purges (paywall_events_purge, tier_retention_purge_attempts) delete by. Paid plans now keep their
-- history forever — 36 500 days, the dashboard's ALL_TIME_DAYS — so "All time" really is all of it; free keeps 7.
-- A large number rather than NULL: every reader already falls back on NULL (to 7 or 90), which would quietly shrink
-- a paid plan's window.
--
-- Idempotent: plain UPDATEs to fixed values.

UPDATE public.tier_definitions SET analytics_retention_days = 36500 WHERE tier_name IN ('pro', 'enterprise');
UPDATE public.tier_definitions SET analytics_retention_days = 7     WHERE tier_name = 'free';
