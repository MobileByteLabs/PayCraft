-- PayCraft: RPC functions for subscription checks

CREATE OR REPLACE FUNCTION is_premium(user_email text)
RETURNS boolean AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.subscriptions
        WHERE email = lower(user_email)
        AND status IN ('active', 'trialing')
        AND current_period_end > now()
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION get_subscription(user_email text)
RETURNS SETOF public.subscriptions AS $$
BEGIN
    RETURN QUERY
        SELECT * FROM public.subscriptions
        WHERE email = lower(user_email)
        AND status IN ('active', 'past_due')
        ORDER BY current_period_end DESC
        LIMIT 1;
END;
$$ LANGUAGE plpgsql;
