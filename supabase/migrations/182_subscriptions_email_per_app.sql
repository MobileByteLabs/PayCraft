-- 182: a subscription email is unique per APP, not across the whole platform.
--
-- Migration 015 replaced the global UNIQUE(email) with a per-tenant key
-- (idx_subscriptions_tenant_email on COALESCE(tenant_id, …), email), but production also carried an
-- out-of-band constraint `subscriptions_email_unique` and the 001 index `idx_subscriptions_email`, so
-- the same buyer could not subscribe in two apps: the second app's checkout failed on a duplicate key.
-- Fresh databases built from migrations never had either — this brings production in line.
--
-- Also adds has_active_subscription(email, api_key): the paywall asks it BEFORE opening a web
-- checkout, so a buyer who already pays for this app is sent to restore (sign in with Google/Apple)
-- instead of being charged a second time. It answers one boolean for the app the key belongs to —
-- the same disclosure the older is_premium(user_email) already makes — and nothing about the row.
--
-- Idempotent: DROP … IF EXISTS / CREATE … IF NOT EXISTS / CREATE OR REPLACE.

ALTER TABLE public.subscriptions DROP CONSTRAINT IF EXISTS subscriptions_email_unique;
DROP INDEX IF EXISTS public.idx_subscriptions_email;

CREATE UNIQUE INDEX IF NOT EXISTS idx_subscriptions_tenant_email
    ON public.subscriptions (COALESCE(tenant_id, '00000000-0000-0000-0000-000000000000'::uuid), email);

CREATE OR REPLACE FUNCTION public.has_active_subscription(p_email TEXT, p_api_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_tenant_id UUID := resolve_tenant(p_api_key);
    v_mode      TEXT;
BEGIN
    IF p_email IS NULL OR btrim(p_email) = '' THEN
        RETURN false;
    END IF;
    -- The key's own mode: a test-mode subscription must not block a live purchase, nor vice versa.
    SELECT CASE WHEN api_key_live = p_api_key THEN 'live' ELSE 'test' END INTO v_mode
    FROM tenants WHERE id = v_tenant_id;

    RETURN EXISTS (
        SELECT 1 FROM subscriptions s
        WHERE s.email = lower(btrim(p_email))
          AND s.status IN ('active', 'trialing')
          AND (v_mode IS NULL OR s.mode = v_mode)
          AND s.current_period_end > now()
          AND (s.tenant_id IS NOT DISTINCT FROM v_tenant_id)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.has_active_subscription(TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_active_subscription(TEXT, TEXT) TO anon, authenticated, service_role;
