-- 201 — a failed Play / App Store attempt keeps the store's reason (2026-11-17).
--
-- THE GAP
-- record_store_attempt (188) stored only 'payment_failed'. Reels Downloader logged 41 Play failures from
-- 21 people in three days with no way to tell a declined card from a misconfigured product. The SDK now
-- sends a short, PII-free code: connect_<n>, product_not_found, no_offer, no_activity, launch_<n>,
-- purchase_<n> (<n> = the store's response code), timeout, ok_no_purchase.
--
-- Additive: a 7-argument overload with p_reason. 188's 6-argument function stays, so apps on older SDKs
-- keep recording attempts. The reason is sanitised to [a-z0-9_:.-], 64 chars.
-- Idempotent: ADD COLUMN IF NOT EXISTS / CREATE OR REPLACE.

ALTER TABLE public.checkout_attempts ADD COLUMN IF NOT EXISTS failure_reason TEXT;

CREATE OR REPLACE FUNCTION public.record_store_attempt(
    p_api_key TEXT, p_app_user_id TEXT, p_provider TEXT, p_product_id TEXT, p_outcome TEXT, p_attempt_id TEXT,
    p_reason TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
    v_reason TEXT := nullif(left(regexp_replace(lower(coalesce(p_reason, '')), '[^a-z0-9_:.-]', '', 'g'), 64), '');
    v_ok     BOOLEAN;
BEGIN
    v_ok := record_store_attempt(p_api_key, p_app_user_id, p_provider, p_product_id, p_outcome, p_attempt_id);
    IF v_ok AND v_reason IS NOT NULL THEN
        UPDATE checkout_attempts SET failure_reason = v_reason
        WHERE provider = p_provider AND provider_session_id = p_attempt_id AND failure_reason IS NULL;
    END IF;
    RETURN v_ok;
END;
$$;

REVOKE ALL ON FUNCTION public.record_store_attempt(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_store_attempt(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
