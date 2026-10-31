-- 160_entitlement_owns_sku.sql — per-sku ownership for one-time (non-consumable) products.
--
-- ## What this answers
--
-- `is_premium` answers "is this user entitled to ANYTHING premium". A store needs the narrower
-- question "does this user already own THIS sku", so a bought lifetime unlock stops being offered
-- for sale and the content it unlocks opens. Without it `PayCraftProductGate` cannot exist, and a
-- store would happily sell a user something they already paid for.
--
-- ## Identity, same as 159
--
-- Tenant from the publishable key, subject from the device token — neither is a caller-supplied id.
-- See 159 for why: a caller-supplied subject on a SECURITY DEFINER function granted to `anon` lets
-- one holder of the (client-shipped) publishable key read another user's entitlements.
--
-- The predicate mirrors `is_premium` (155) exactly — subject match, falling back to email so a
-- backfill gap never revokes access — and adds two things:
--
--   * `s.plan = p_sku`, which is what makes it per-product; and
--   * `current_period_end IS NULL` as current, because a lifetime entitlement carries a NULL
--     expiry (090). `is_premium` requires `> now()` and so would read every lifetime unlock as
--     EXPIRED. Checking NULL first also short-circuits before the NULL comparison that would
--     otherwise evaluate to NULL and read as false — the ordering 090 calls out explicitly.
--
-- ## Known limit, stated rather than hidden
--
-- `subscriptions` carries UNIQUE(email) (migration 001), so it holds at most ONE row per user and
-- therefore cannot represent a user who owns two different one-time products. `entitlement_records`
-- (072) can — it keys on (provider, stable_txn_id) and carries `product_id` — and 090 already built
-- `is_premium_by_app_user` on it. But 155 records it as `0 rows in production (2026-10-16)`: nothing
-- populates it yet, and its `app_user_id TEXT` has no defined relationship to an entitlement subject.
--
-- Reading it here would mean inventing that relationship (is app_user_id the subject uuid? the
-- email?) and shipping a guess as a security predicate. So this reads the table that is actually
-- live. When entitlement_records starts being written AND its identity column is pinned to a
-- subject, this function should move to it and the single-product limit disappears with the move.
-- Until then: one one-time product per user, which is what the storage can honestly express.
--
-- Idempotent: CREATE OR REPLACE / GRANT / REVOKE are safe to re-run (CLAUDE.md migration rules).

CREATE OR REPLACE FUNCTION public.entitlement_owns(
    p_server_token TEXT,
    p_api_key      TEXT,
    p_sku          TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_tenant  UUID;
    v_subject UUID;
    v_email   TEXT;
    v_mode    TEXT;
BEGIN
    v_tenant := resolve_tenant(p_api_key);
    IF v_tenant IS NULL THEN
        RAISE EXCEPTION 'unknown or inactive api key' USING ERRCODE = 'invalid_authorization_specification';
    END IF;

    SELECT email, mode, subject_id INTO v_email, v_mode, v_subject
    FROM registered_devices
    WHERE device_token = p_server_token
      AND is_active = true
      AND (tenant_id IS NOT DISTINCT FROM v_tenant);

    -- Not registered yet is "owns nothing", not an error: a signed-out browser of the store is an
    -- ordinary state. FALSE is also the safe default — it offers the product for sale rather than
    -- unlocking content nobody paid for.
    IF v_email IS NULL THEN
        RETURN false;
    END IF;

    RETURN EXISTS (
        SELECT 1 FROM subscriptions s
        WHERE ((v_subject IS NOT NULL AND s.subject_id = v_subject) OR s.email = lower(v_email))
          AND s.plan = p_sku
          AND s.status IN ('active', 'trialing', 'active_non_renewing')
          AND (s.current_period_end IS NULL OR s.current_period_end > now())
          AND s.mode = v_mode
          AND (s.tenant_id IS NOT DISTINCT FROM v_tenant)
    );
END;
$$;

COMMENT ON FUNCTION public.entitlement_owns(TEXT, TEXT, TEXT) IS
  'CLIENT-FACING per-sku ownership for one-time products. Tenant from the publishable key, subject '
  'from the device token (never caller-supplied). Treats a NULL current_period_end as current, '
  'because a lifetime entitlement carries no expiry (090).';

GRANT EXECUTE ON FUNCTION public.entitlement_owns(TEXT, TEXT, TEXT) TO anon, authenticated;
