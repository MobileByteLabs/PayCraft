-- PayCraft: RPC functions for subscription checks
-- SECURITY DEFINER: runs as function owner so anon key can query subscriptions (RLS bypass)

CREATE OR REPLACE FUNCTION is_premium(user_email text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.subscriptions
        WHERE email = lower(user_email)
        AND status IN ('active', 'trialing')
        AND current_period_end > now()
    );
END;
$$;

CREATE OR REPLACE FUNCTION get_subscription(user_email text)
RETURNS SETOF public.subscriptions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
        SELECT * FROM public.subscriptions
        WHERE email = lower(user_email)
        AND status IN ('active', 'past_due')
        ORDER BY current_period_end DESC
        LIMIT 1;
END;
$$;

-- Grant execute to anon and authenticated roles
GRANT EXECUTE ON FUNCTION is_premium(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION get_subscription(text) TO anon, authenticated;
