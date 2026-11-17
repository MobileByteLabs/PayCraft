-- 197 — moving a subscriber between plans (Plus → Pro → Max) without a second subscription.
--
-- Each tenant keeps ONE subscriptions row per email, so a second checkout overwrote the row while the first
-- provider subscription kept billing — the member paid twice. The `subscription-change` function now changes
-- the provider subscription itself (Stripe: price swap, prorated now; Razorpay: plan swap at the end of the
-- cycle) and records the result here:
--   subscriptions.pending_plan / plan_changes_at   the plan the member moves to, and when (NULL = now)
--   subscription_effective_plan(id)                pending_plan once due, else plan — a renewal webhook that
--                                                  rewrites `plan` from stale provider notes cannot undo a change
--   subscription_change_caller(token, api_key)      the caller's live subscription (service role)
--   subscription_set_pending_plan(id, plan, at)     record a change (service role); at NULL = immediate
-- The 196 per-plan grant reads the effective plan.

ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS pending_plan TEXT;
ALTER TABLE public.subscriptions ADD COLUMN IF NOT EXISTS plan_changes_at TIMESTAMPTZ;

CREATE OR REPLACE FUNCTION public.subscription_effective_plan(p_subscription_id UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE WHEN pending_plan IS NOT NULL AND plan_changes_at <= now() THEN pending_plan ELSE plan END
    FROM subscriptions WHERE id = p_subscription_id
$$;

CREATE OR REPLACE FUNCTION public.subscription_change_caller(p_server_token TEXT, p_api_key TEXT)
RETURNS TABLE (subscription_id UUID, tenant_id UUID, email TEXT, provider TEXT, provider_subscription_id TEXT,
               plan TEXT, pending_plan TEXT, plan_changes_at TIMESTAMPTZ, mode TEXT, current_period_end TIMESTAMPTZ)
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
BEGIN
  v_tenant := resolve_tenant(p_api_key);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'unknown or inactive api key' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  RETURN QUERY
  SELECT s.id, s.tenant_id, s.email, s.provider, s.provider_subscription_id,
         subscription_effective_plan(s.id), s.pending_plan, s.plan_changes_at, s.mode, s.current_period_end
    FROM registered_devices d
    JOIN subscriptions s ON (s.subject_id = d.subject_id OR s.email = lower(d.email))
   WHERE d.device_token = p_server_token AND d.is_active AND d.tenant_id IS NOT DISTINCT FROM v_tenant
     AND s.tenant_id IS NOT DISTINCT FROM v_tenant AND s.mode = d.mode
     AND s.status IN ('active', 'trialing') AND s.current_period_end > now()
   ORDER BY s.current_period_end DESC
   LIMIT 1;
END $$;

CREATE OR REPLACE FUNCTION public.subscription_set_pending_plan(p_subscription_id UUID, p_plan TEXT, p_changes_at TIMESTAMPTZ)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_changes_at IS NULL OR p_changes_at <= now() THEN
    UPDATE subscriptions SET plan = p_plan, pending_plan = NULL, plan_changes_at = NULL, updated_at = now() WHERE id = p_subscription_id;
  ELSE
    -- A scheduled change that has already taken effect becomes `plan` first, so scheduling the next one
    -- (e.g. a downgrade after an upgrade) never falls back to the plan before both.
    UPDATE subscriptions SET plan = CASE WHEN pending_plan IS NOT NULL AND plan_changes_at <= now() THEN pending_plan ELSE plan END,
                             pending_plan = p_plan, plan_changes_at = p_changes_at, updated_at = now()
     WHERE id = p_subscription_id;
  END IF;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'subscription % not found', p_subscription_id USING ERRCODE = 'no_data_found';
  END IF;
END $$;

-- 196's per-plan grant, now on the effective plan.
CREATE OR REPLACE FUNCTION public._allowance_plan_grant(p_tenant UUID, p_subject UUID, p_server_token TEXT, p_grants JSONB)
RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT max((p_grants->>subscription_effective_plan(s.id))::INT)
    FROM subscriptions s
    JOIN registered_devices d ON d.device_token = p_server_token AND d.is_active AND d.tenant_id IS NOT DISTINCT FROM p_tenant
   WHERE p_grants IS NOT NULL
     AND (s.subject_id = p_subject OR s.email = lower(d.email))
     AND s.tenant_id IS NOT DISTINCT FROM p_tenant
     AND s.mode = d.mode
     AND s.status IN ('active', 'trialing')
     AND s.current_period_end > now()
     AND p_grants ? subscription_effective_plan(s.id)
$$;

REVOKE EXECUTE ON FUNCTION public.subscription_change_caller(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.subscription_set_pending_plan(UUID, TEXT, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.subscription_effective_plan(UUID) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.subscription_change_caller(TEXT, TEXT) TO service_role;
GRANT  EXECUTE ON FUNCTION public.subscription_set_pending_plan(UUID, TEXT, TIMESTAMPTZ) TO service_role;
GRANT  EXECUTE ON FUNCTION public.subscription_effective_plan(UUID) TO service_role;
REVOKE EXECUTE ON FUNCTION public._allowance_plan_grant(UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
