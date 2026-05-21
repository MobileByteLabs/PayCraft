-- Test for migration 027: sticky trial_end preservation across resubs.
-- ============================================================================
-- Run after applying migration 027:
--   psql "$DATABASE_URL" -f server/tests/test_027_trial_preserve.sql

BEGIN;

DO $$
DECLARE
    v_email       TEXT := 'trial-preserve-test@paycraft.local';
    v_token       TEXT := 'srv_test_027_preserve';
    v_first_end   TIMESTAMPTZ := now() + interval '7 days';
    v_extended    TIMESTAMPTZ := now() + interval '14 days';
    v_stored_end  TIMESTAMPTZ;
    v_eligible    BOOLEAN;
BEGIN
    -- Reset.
    DELETE FROM subscriptions WHERE email = v_email;
    DELETE FROM registered_devices WHERE device_token = v_token;

    INSERT INTO registered_devices (email, device_token, platform, device_name, device_id, mode, is_active)
    VALUES (v_email, v_token, 'android', 'TestDevice', 'dev_027', 'live', true);

    -- 1. First subscription with a 7-day trial.
    INSERT INTO subscriptions (email, provider, provider_subscription_id, plan, status, mode,
                                current_period_start, current_period_end, trial_start, trial_end)
    VALUES (v_email, 'stripe', 'sub_first', 'monthly', 'trialing', 'live',
            now() - interval '1 hour', v_first_end,
            now() - interval '1 hour', v_first_end);

    SELECT trial_end INTO v_stored_end FROM subscriptions WHERE email = v_email;
    IF v_stored_end IS NULL THEN
        RAISE EXCEPTION 'Setup failed: INSERT did not record trial_end';
    END IF;
    RAISE NOTICE 'OK: setup — initial trial_end = %', v_stored_end;

    -- ── Assert A: resub UPDATE clearing trial_end → trigger preserves it ──
    -- Simulates webhook handler upserting with NEW.trial_end = NULL
    -- (e.g. user cancelled, resubbed, new Stripe price has no trial_period_days).
    UPDATE subscriptions
    SET provider_subscription_id = 'sub_resub_no_trial',
        status = 'active',
        current_period_end = now() + interval '30 days',
        trial_start = NULL,
        trial_end = NULL
    WHERE email = v_email;

    SELECT trial_end INTO v_stored_end FROM subscriptions WHERE email = v_email;
    IF v_stored_end IS NULL THEN
        RAISE EXCEPTION 'TRIGGER FAILED: trial_end was cleared by resub UPDATE (cancel-resub bypass open)';
    END IF;
    IF v_stored_end <> v_first_end THEN
        RAISE EXCEPTION 'TRIGGER FAILED: trial_end mutated from % to %', v_first_end, v_stored_end;
    END IF;
    RAISE NOTICE 'OK: resub UPDATE with NULL trial_end → preserved historical %', v_stored_end;

    -- ── Assert B: is_trial_eligible reflects preservation ──
    SELECT is_trial_eligible(v_token, NULL) INTO v_eligible;
    IF v_eligible THEN
        RAISE EXCEPTION 'TR-006 BYPASS: is_trial_eligible returned true after resub — second trial possible';
    END IF;
    RAISE NOTICE 'OK: is_trial_eligible = false after resub (TR-006 holds)';

    -- ── Assert C: legitimate trial extension (NEW non-null) still works ──
    -- Stripe sends subscription.updated with an extended trial → trigger should allow.
    UPDATE subscriptions
    SET trial_end = v_extended,
        trial_start = now() - interval '1 hour'
    WHERE email = v_email;

    SELECT trial_end INTO v_stored_end FROM subscriptions WHERE email = v_email;
    IF v_stored_end <> v_extended THEN
        RAISE EXCEPTION 'TRIGGER OVER-RESTRICTIVE: legitimate trial extension was blocked (expected %, got %)', v_extended, v_stored_end;
    END IF;
    RAISE NOTICE 'OK: trial extension UPDATE (NEW non-null) honored → trial_end = %', v_stored_end;

    -- ── Cleanup ──
    DELETE FROM subscriptions WHERE email = v_email;
    DELETE FROM registered_devices WHERE device_token = v_token;

    RAISE NOTICE 'ALL TRIAL-PRESERVATION TESTS PASSED';
END $$;

COMMIT;
