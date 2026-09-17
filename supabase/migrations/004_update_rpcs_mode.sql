-- PayCraft: Update RPCs to filter by mode
-- stripe_mode defaults to 'live' — backward-compatible with existing callers.
-- Test mode callers pass stripe_mode = 'test' to isolate sandbox subscriptions.

CREATE OR REPLACE FUNCTION is_premium(user_email text, stripe_mode text DEFAULT 'live')
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.subscriptions
        WHERE email = lower(user_email)
        AND mode = stripe_mode
        AND status IN ('active', 'trialing')
        AND current_period_end > now()
    );
END;
$$;

CREATE OR REPLACE FUNCTION get_subscription(user_email text, stripe_mode text DEFAULT 'live')
RETURNS SETOF public.subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
        SELECT * FROM public.subscriptions
        WHERE email = lower(user_email)
        AND mode = stripe_mode
        AND status IN ('active', 'past_due')
        ORDER BY current_period_end DESC
        LIMIT 1;
END;
$$;

-- Grant execute to anon and authenticated roles
GRANT EXECUTE ON FUNCTION is_premium(text, text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_subscription(text, text) TO anon, authenticated;
