-- 185: health incidents — the memory behind functions/v1/health's alert emails and /admin/health.
--
-- Every health poll reports each check as ok / failing. A check that starts failing OPENS an incident
-- and the platform owner is emailed once; when it passes again the incident RESOLVES and a recovery
-- email says how long it lasted. The partial unique index is what makes "once" true: of any number of
-- concurrent polls (GitHub cron, uptime monitors, a human on /health) exactly one can open the
-- incident, so exactly one email goes out.
--
-- Motivating incident: live Stripe webhooks failed from 2026-05 to 2026-11 and nobody was told.
-- Idempotent: IF NOT EXISTS / CREATE OR REPLACE / DROP POLICY IF EXISTS.

CREATE TABLE IF NOT EXISTS public.health_incidents (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    check_name   TEXT NOT NULL,
    opened_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at  TIMESTAMPTZ,
    first_detail TEXT,
    last_detail  TEXT,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS health_incidents_one_open_per_check
    ON public.health_incidents (check_name) WHERE resolved_at IS NULL;
CREATE INDEX IF NOT EXISTS health_incidents_opened_at ON public.health_incidents (opened_at DESC);

ALTER TABLE public.health_incidents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS health_incidents_owner_read ON public.health_incidents;
CREATE POLICY health_incidents_owner_read ON public.health_incidents
    FOR SELECT TO authenticated USING (public.is_platform_owner());

-- TRUE only for the call that opened the incident (→ send the alert); later failing polls refresh it.
CREATE OR REPLACE FUNCTION public.health_incident_open(p_check TEXT, p_detail TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_id UUID;
BEGIN
    INSERT INTO health_incidents (check_name, first_detail, last_detail)
    VALUES (p_check, p_detail, p_detail)
    ON CONFLICT (check_name) WHERE resolved_at IS NULL DO NOTHING
    RETURNING id INTO v_id;
    IF v_id IS NULL THEN
        UPDATE health_incidents SET last_detail = p_detail, last_seen_at = now()
        WHERE check_name = p_check AND resolved_at IS NULL;
        RETURN false;
    END IF;
    RETURN true;
END;
$$;

-- The opened_at of the incident this call closed (→ send the recovery email), or NULL if none was open.
CREATE OR REPLACE FUNCTION public.health_incident_resolve(p_check TEXT)
RETURNS TIMESTAMPTZ
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
    UPDATE health_incidents SET resolved_at = now(), last_seen_at = now()
    WHERE check_name = p_check AND resolved_at IS NULL
    RETURNING opened_at;
$$;

REVOKE ALL ON FUNCTION public.health_incident_open(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.health_incident_resolve(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.health_incident_open(TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.health_incident_resolve(TEXT) TO service_role;
