-- T7 — SQL test: trialing subscription is_premium
-- ============================================================================
-- Run after applying migration 026:
--   psql "$DATABASE_URL" -f server/tests/test_026_trial.sql
-- Exits non-zero on any RAISE EXCEPTION; success prints "OK" rows only.
-- Cleans up its test data; safe to re-run.

BEGIN;

-- ── Setup ─────────────────────────────────────────────────────────────────
-- Use a deterministic test email + device token so cleanup is exact.
DO $$
DECLARE
    v_email   TEXT := 'trial-test-026@paycraft.local';
    v_token   TEXT := 'srv_test_026_trialing';
    v_premium BOOLEAN;
    v_sub     subscriptions%ROWTYPE;
    v_elig    BOOLEAN;
BEGIN
    -- Reset any prior test rows.
    DELETE FROM subscriptions WHERE email = v_email;
    DELETE FROM registered_devices WHERE device_token = v_token;

    -- Register device (single-tenant, p_api_key = NULL).
    INSERT INTO registered_devices (email, device_token, platform, device_name, device_id, mode, is_active)
    VALUES (v_email, v_token, 'android', 'TestDevice', 'dev_026', 'live', true);

    -- Insert a trialing subscription with trial_end in the future.
    INSERT INTO subscriptions (
        email, provider, provider_subscription_id, plan, status, mode,
        current_period_start, current_period_end, cancel_at_period_end,
        trial_start, trial_end
    )
    VALUES (
        v_email, 'stripe', 'sub_test_026', 'monthly', 'trialing', 'live',
        now() - interval '1 hour', now() + interval '6 days', false,
        now() - interval '1 hour', now() + interval '6 days'
    );

    -- ── Assert 1: is_premium returns true for trialing subscription ──
    SELECT is_premium(v_token, NULL) INTO v_premium;
    IF NOT v_premium THEN
        RAISE EXCEPTION 'TR-002 FAILED: is_premium returned false for trialing subscription with trial_end > now()';
    END IF;
    RAISE NOTICE 'OK: TR-002 — is_premium(token) = true for trialing row';

    -- ── Assert 2: get_subscription returns the trialing row ──
    SELECT * INTO v_sub FROM get_subscription(v_token, NULL);
    IF v_sub.status IS NULL THEN
        RAISE EXCEPTION 'TR-003 FAILED: get_subscription returned no row for trialing subscription';
    END IF;
    IF v_sub.status <> 'trialing' THEN
        RAISE EXCEPTION 'TR-003 FAILED: expected status=trialing, got %', v_sub.status;
    END IF;
    IF v_sub.trial_end IS NULL THEN
        RAISE EXCEPTION 'TR-003 FAILED: trial_end column not returned';
    END IF;
    RAISE NOTICE 'OK: TR-003 — get_subscription returns trialing row with trial_end populated';

    -- ── Assert 3: is_trial_eligible = false (user has consumed a trial) ──
    SELECT is_trial_eligible(v_token, NULL) INTO v_elig;
    IF v_elig THEN
        RAISE EXCEPTION 'TR-006 FAILED: is_trial_eligible returned true after a trial was recorded';
    END IF;
    RAISE NOTICE 'OK: TR-006 — is_trial_eligible = false after trial recorded';

    -- ── Assert 4: is_trial_eligible = true for fresh user ──
    DELETE FROM subscriptions WHERE email = v_email;
    SELECT is_trial_eligible(v_token, NULL) INTO v_elig;
    IF NOT v_elig THEN
        RAISE EXCEPTION 'TR-006 FAILED: is_trial_eligible returned false for user with no subscription history';
    END IF;
    RAISE NOTICE 'OK: TR-006 — is_trial_eligible = true for fresh user';

    -- ── Cleanup ──
    DELETE FROM registered_devices WHERE device_token = v_token;

    RAISE NOTICE 'ALL TRIAL TESTS PASSED';
END $$;

COMMIT;
