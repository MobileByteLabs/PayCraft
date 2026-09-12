-- Migration 027: Sticky trial fields — preserve trial_end across resubs
-- ============================================================================
-- Closes the cancel-and-resubscribe second-trial bypass flagged in
-- docs/VERIFY_TRIAL.md § 7 #2.
--
-- Scenario: user starts a 7-day trial → cancels mid-trial → resubscribes a
-- month later. Stripe issues a NEW provider_subscription_id; webhook UPSERTs
-- on the email key (`onConflict: 'email'`); the new subscription has no
-- trial (Stripe Price wasn't reconfigured) so trial_start/trial_end arrive
-- as NULL; the UPSERT overwrites the historical values; is_trial_eligible
-- (which checks `trial_end IS NOT NULL`) returns true again → user gets a
-- second free trial.
--
-- Fix: a BEFORE UPDATE trigger that treats trial_start/trial_end as sticky.
-- Once set, an UPDATE that tries to clear them (new value NULL) is rejected
-- in favor of the historical value. Legitimate trial extensions (new value
-- non-null — e.g., Stripe `subscription.updated` extends a trial) are still
-- honored.
--
-- TR-006 (server-derived trial eligibility) now holds across resubs.

BEGIN;

CREATE OR REPLACE FUNCTION subscriptions_preserve_trial_fields()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
    -- Only run on UPDATE (INSERT goes through unmodified — first trial gets recorded).
    IF (TG_OP = 'UPDATE') THEN
        -- Sticky trial_end: never allow clear.
        IF OLD.trial_end IS NOT NULL AND NEW.trial_end IS NULL THEN
            NEW.trial_end := OLD.trial_end;
            -- Keep trial_start paired with trial_end for data consistency.
            NEW.trial_start := OLD.trial_start;
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS subscriptions_preserve_trial_fields_trigger ON public.subscriptions;

CREATE TRIGGER subscriptions_preserve_trial_fields_trigger
    BEFORE UPDATE ON public.subscriptions
    FOR EACH ROW
    EXECUTE FUNCTION subscriptions_preserve_trial_fields();

COMMENT ON FUNCTION subscriptions_preserve_trial_fields() IS
    'PayCraft v1.1: enforces TR-006 across resubs. trial_end / trial_start are set-once-preserve — UPDATEs may extend a trial (NEW non-null) but cannot clear it (NEW null + OLD non-null → keep OLD).';

COMMIT;
