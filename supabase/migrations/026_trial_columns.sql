-- Migration 026: Trial-product support
-- ============================================================================
-- Adds `trial_start` / `trial_end` columns to `subscriptions`, surfaces
-- `'trialing'` status through `get_subscription`, and introduces a server-
-- derived `is_trial_eligible` RPC (TR-006: no second trial).
--
-- Plan: plan-layer/project-plans/mbs/PayCraft/active/PLAN-paycraft-trial-support.md
-- Spec: idea-layer/REQUIREMENTS.md TR-001..006, idea-layer/API_CONTRACTS.md
--
-- NOTE: `is_premium` is intentionally UNCHANGED — its existing
-- `status IN ('active', 'trialing') AND current_period_end > now()` filter
-- already gates trialing subscriptions correctly (TR-002).

BEGIN;

-- ───────────────────────────────────────────────────────────────────────────
-- T1 — schema columns (idempotent)
-- ───────────────────────────────────────────────────────────────────────────

ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS trial_start timestamptz NULL,
    ADD COLUMN IF NOT EXISTS trial_end   timestamptz NULL;

COMMENT ON COLUMN public.subscriptions.trial_start IS
    'PayCraft v1.1: provider-emitted trial start. NULL = no trial.';
COMMENT ON COLUMN public.subscriptions.trial_end IS
    'PayCraft v1.1: provider-emitted trial end. NULL = no trial. Client computes isInTrial = (now() < trial_end).';

-- ───────────────────────────────────────────────────────────────────────────
-- T3 — get_subscription: include 'trialing' status
-- ───────────────────────────────────────────────────────────────────────────
-- Existing filter `status IN ('active', 'past_due')` hid trialing rows from
-- the client. Trial columns are now part of the returned row via SELECT *.

CREATE OR REPLACE FUNCTION get_subscription(
    p_server_token TEXT,
    p_api_key      TEXT DEFAULT NULL
)
RETURNS SETOF subscriptions
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id UUID;
    v_email     TEXT;
    v_mode      TEXT;
BEGIN
    v_tenant_id := resolve_tenant(p_api_key);

    SELECT email, mode INTO v_email, v_mode
    FROM registered_devices
    WHERE device_token = p_server_token
      AND is_active = true
      AND (tenant_id IS NOT DISTINCT FROM v_tenant_id);

    IF v_email IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
        SELECT * FROM subscriptions
        WHERE email = lower(v_email)
          AND status IN ('active', 'trialing', 'past_due')
          AND mode = v_mode
          AND (tenant_id IS NOT DISTINCT FROM v_tenant_id)
        ORDER BY current_period_end DESC NULLS LAST
        LIMIT 1;
END;
$$;

GRANT EXECUTE ON FUNCTION get_subscription(text, text) TO anon, authenticated;

-- ───────────────────────────────────────────────────────────────────────────
-- T2 — is_trial_eligible: derived eligibility (TR-006)
-- ───────────────────────────────────────────────────────────────────────────
-- A user is eligible for a trial iff no subscription row for their email has
-- ever recorded a trial_end. Server-side enforcement: no client flag.

CREATE OR REPLACE FUNCTION is_trial_eligible(
    p_server_token TEXT,
    p_api_key      TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id UUID;
    v_email     TEXT;
BEGIN
    v_tenant_id := resolve_tenant(p_api_key);

    SELECT email INTO v_email
    FROM registered_devices
    WHERE device_token = p_server_token
      AND is_active = true
      AND (tenant_id IS NOT DISTINCT FROM v_tenant_id);

    -- Unregistered token: treat as new user → eligible.
    -- (Adopt-flow may call this before login completes; cf. design D5.)
    IF v_email IS NULL THEN
        RETURN true;
    END IF;

    RETURN NOT EXISTS (
        SELECT 1 FROM subscriptions
        WHERE email = lower(v_email)
          AND trial_end IS NOT NULL
          AND (tenant_id IS NOT DISTINCT FROM v_tenant_id)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION is_trial_eligible(text, text) TO anon, authenticated;

COMMIT;
