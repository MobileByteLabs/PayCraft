-- 155 — resolve entitlement by SUBJECT, on the path that is actually live.
--
-- ## What 154 did, and why it was not enough
--
-- 154 introduced subjects + identity aliases. It changed no behaviour, deliberately. The obvious
-- follow-up — "have the SDK send a subject as app_user_id" — would ALSO have changed no behaviour,
-- because `app_user_id` is not on the live read path:
--
--   entitlement_records   0 rows in production (2026-10-16)
--   get_entitlements()    the only RPC taking p_app_user_id
--
-- The live path is the device join, and it is keyed on EMAIL:
--
--   device_token -> registered_devices.email -> subscriptions WHERE email = lower(email)
--
-- `is_premium`, `get_subscription` and `check_premium_with_device` all do exactly that. So the
-- cross-device bug lives here, and nowhere else:
--
--   registered_devices   99 devices across 37 emails
--
-- One human with two emails is two identities, and their subscription follows only one of them.
--
-- ## The change
--
-- Both tables gain `subject_id`, backfilled through 154's resolver. The read predicate becomes
-- subject-OR-email.
--
-- ## The safety property: strictly WIDER, never narrower
--
--     AND ( (v_subject IS NOT NULL AND s.subject_id = v_subject)
--           OR s.email = lower(v_email) )
--
-- The second disjunct is today's predicate, unchanged. So every user premium before this migration
-- is premium after it — the change can only ADD matches. A rollback is equally safe: dropping back
-- to the email-only predicate removes only matches that email alone never provided.
--
-- Granting premium to the WRONG person would require two humans sharing a subject, which 154's link
-- rules exist to prevent (a verified side is required, and a merge is refused outright).
--
-- Every other filter — tenant_id, mode, status, current_period_end — is preserved verbatim. A
-- subject match still requires a live subscription in the right tenant and mode.

-- ── Columns ──────────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.registered_devices
    ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES public.entitlement_subjects(id) ON DELETE SET NULL;

ALTER TABLE public.subscriptions
    ADD COLUMN IF NOT EXISTS subject_id UUID REFERENCES public.entitlement_subjects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_registered_devices_subject ON public.registered_devices (subject_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_subject      ON public.subscriptions (subject_id);

COMMENT ON COLUMN public.registered_devices.subject_id IS
  'Entitlement subject for this device''s owner. NULL on rows predating 155 — the read path falls back to email.';
COMMENT ON COLUMN public.subscriptions.subject_id IS
  'Entitlement subject for this subscription. NULL falls back to the email match, so a backfill gap never revokes access.';

-- ── Backfill ─────────────────────────────────────────────────────────────────────────────────────
-- Unverified: these emails come from checkout and device registration, neither of which is an
-- identity-provider attestation. 154's link rule is written for exactly this state.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT lower(btrim(email)) AS email FROM subscriptions
            WHERE email IS NOT NULL AND btrim(email) <> '' LOOP
    UPDATE subscriptions SET subject_id = entitlement_subject_resolve('email', NULL, r.email, false)
     WHERE lower(btrim(email)) = r.email AND subject_id IS NULL;
  END LOOP;

  FOR r IN SELECT DISTINCT lower(btrim(email)) AS email FROM registered_devices
            WHERE email IS NOT NULL AND btrim(email) <> '' LOOP
    UPDATE registered_devices SET subject_id = entitlement_subject_resolve('email', NULL, r.email, false)
     WHERE lower(btrim(email)) = r.email AND subject_id IS NULL;
  END LOOP;
END $$;

-- ── is_premium ───────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION is_premium(
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
    v_mode      TEXT;
    v_subject   UUID;
BEGIN
    v_tenant_id := resolve_tenant(p_api_key);

    SELECT email, mode, subject_id INTO v_email, v_mode, v_subject
    FROM registered_devices
    WHERE device_token = p_server_token
      AND is_active = true
      AND (tenant_id IS NOT DISTINCT FROM v_tenant_id);

    IF v_email IS NULL THEN
        RETURN false;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM subscriptions s
        WHERE ((v_subject IS NOT NULL AND s.subject_id = v_subject) OR s.email = lower(v_email))
          AND s.status IN ('active', 'trialing')
          AND s.mode = v_mode
          AND s.current_period_end > now()
          AND (s.tenant_id IS NOT DISTINCT FROM v_tenant_id)
    );
END;
$$;

-- ── get_subscription ─────────────────────────────────────────────────────────────────────────────
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
    v_subject   UUID;
BEGIN
    v_tenant_id := resolve_tenant(p_api_key);

    SELECT email, mode, subject_id INTO v_email, v_mode, v_subject
    FROM registered_devices
    WHERE device_token = p_server_token
      AND is_active = true
      AND (tenant_id IS NOT DISTINCT FROM v_tenant_id);

    IF v_email IS NULL THEN
        RETURN;
    END IF;

    RETURN QUERY
        SELECT s.* FROM subscriptions s
        WHERE ((v_subject IS NOT NULL AND s.subject_id = v_subject) OR s.email = lower(v_email))
          AND s.status IN ('active', 'trialing', 'past_due')
          AND s.mode = v_mode
          AND (s.tenant_id IS NOT DISTINCT FROM v_tenant_id)
        -- A subject can now match SEVERAL rows (the same human across two emails). Newest wins, so
        -- a caller reading one row gets the live subscription rather than an arbitrary older one.
        ORDER BY s.current_period_end DESC NULLS LAST, s.updated_at DESC;
END;
$$;

-- ── check_premium_with_device ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_premium_with_device(
    p_server_token TEXT,
    p_api_key      TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id  UUID;
    v_email      TEXT;
    v_mode       TEXT;
    v_subject    UUID;
    v_is_premium BOOLEAN;
BEGIN
    v_tenant_id := resolve_tenant(p_api_key);

    UPDATE registered_devices
    SET last_seen_at = now()
    WHERE device_token = p_server_token
      AND is_active = true
      AND (tenant_id IS NOT DISTINCT FROM v_tenant_id)
    RETURNING email, mode, subject_id INTO v_email, v_mode, v_subject;

    IF v_email IS NULL THEN
        RETURN jsonb_build_object('is_premium', false, 'token_valid', false);
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM subscriptions s
        WHERE ((v_subject IS NOT NULL AND s.subject_id = v_subject) OR s.email = lower(v_email))
          AND s.status IN ('active', 'trialing')
          AND s.mode = v_mode
          AND s.current_period_end > now()
          AND (s.tenant_id IS NOT DISTINCT FROM v_tenant_id)
    ) INTO v_is_premium;

    RETURN jsonb_build_object('is_premium', v_is_premium, 'token_valid', true);
END;
$$;

-- ── register_device ──────────────────────────────────────────────────────────────────────────────
-- Stamps the subject at registration, so a device created after this migration never needs the
-- email fallback. The existing-device lookup widens to subject-OR-email for the same reason the
-- read path does: two emails belonging to one human must see each other's device, or the
-- device-conflict flow treats one person as two and lets them hold two "only" devices.
CREATE OR REPLACE FUNCTION register_device(
    p_email       TEXT,
    p_platform    TEXT,
    p_device_name TEXT,
    p_device_id   TEXT,
    p_mode        TEXT DEFAULT 'live',
    p_api_key     TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant_id  UUID;
    v_token      TEXT;
    v_existing   RECORD;
    v_conflict   BOOLEAN := false;
    v_subject    UUID;
BEGIN
    v_tenant_id := resolve_tenant(p_api_key);
    v_subject   := entitlement_subject_resolve('email', NULL, p_email, false);

    SELECT device_token, device_name, platform, last_seen_at
    INTO v_existing
    FROM registered_devices
    WHERE ((v_subject IS NOT NULL AND subject_id = v_subject) OR lower(email) = lower(p_email))
      AND mode = p_mode
      AND is_active = true
      AND (tenant_id IS NOT DISTINCT FROM v_tenant_id)
    ORDER BY registered_at DESC
    LIMIT 1;

    -- `v_existing.device_token IS NOT NULL`, NOT `v_existing IS NOT NULL`.
    --
    -- For a RECORD, `IS NOT NULL` is true only when EVERY field is non-null. `last_seen_at` is NULL
    -- until a device first calls check_premium_with_device, so the original test silently evaluated
    -- FALSE for any freshly registered device — conflict detection never fired, and a user could
    -- register a second device without ever seeing the transfer flow that exists to stop exactly
    -- that. Pre-existing since 016 and live in production; found 2026-10-16 by an assertion that
    -- registered two devices before either had been seen.
    --
    -- device_token is NOT NULL by construction, so it tests "did the SELECT find a row".
    IF v_existing.device_token IS NOT NULL THEN
        IF v_existing.device_name = p_device_name AND v_existing.platform = p_platform THEN
            RETURN jsonb_build_object(
                'server_token', v_existing.device_token,
                'conflict', false,
                'conflicting_device_name', null,
                'conflicting_last_seen', null
            );
        END IF;
        v_conflict := true;
    END IF;

    v_token := 'srv_' || replace(gen_random_uuid()::text, '-', '');

    -- `is_active = NOT v_conflict` IS LOAD-BEARING. The column DEFAULTS TO FALSE, and all three
    -- read RPCs filter `is_active = true` — so omitting it here makes every newly registered
    -- device resolve as NOT PREMIUM. A paying customer installing on a new phone would silently
    -- lose access, and nothing would error.
    --
    -- A conflicting device is registered INACTIVE on purpose: it gets a token so the client can
    -- drive the transfer flow, but it must not be entitled until the user resolves the conflict.
    INSERT INTO registered_devices
        (email, device_token, platform, device_name, device_id, mode, is_active, tenant_id, subject_id)
    VALUES
        (lower(p_email), v_token, p_platform, p_device_name, p_device_id, p_mode,
         NOT v_conflict, v_tenant_id, v_subject);

    RETURN jsonb_build_object(
        'server_token', v_token,
        'conflict', v_conflict,
        'conflicting_device_name', CASE WHEN v_conflict THEN v_existing.device_name ELSE null END,
        'conflicting_last_seen',   CASE WHEN v_conflict THEN v_existing.last_seen_at ELSE null END
    );
END;
$$;

-- Grants restated so this migration is self-describing (CREATE OR REPLACE preserves them).
GRANT EXECUTE ON FUNCTION is_premium(text, text)                TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_subscription(text, text)          TO anon, authenticated;
GRANT EXECUTE ON FUNCTION check_premium_with_device(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION register_device(text, text, text, text, text, text) TO anon, authenticated;
