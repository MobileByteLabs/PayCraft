-- 220 — a buyer switching plans is not a failure (attempt alerts, 211).
--
-- When a buyer taps a second plan while an attempt is open, the SDK closes the first one with
-- `sdk / flow_switch / new_plan_select` (AttemptTracker) so its timeline ends. 211's spike rule counted every row
-- with an error class except the "buyer left" outcomes — and flow_switch was missing from that list. Reels
-- Downloader 2026-11-25 12:35–13:35 UTC: one person comparing plans produced "CRITICAL — Failure spike at the sdk
-- stage, 9 failures" with nothing broken. flow_switch joins abandon_timeout as a leave, not a breakage.
--
-- Idempotent: CREATE OR REPLACE of 211's function, same signature.

CREATE OR REPLACE FUNCTION public.attempt_event_is_failure(p_event TEXT, p_error_class TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT p_error_class IS NOT NULL
     AND p_event NOT IN ('abandoned', 'provider_abandoned', 'paid_not_granted')
     AND p_error_class NOT IN ('abandon_timeout', 'paid_not_granted', 'flow_switch')
$$;
