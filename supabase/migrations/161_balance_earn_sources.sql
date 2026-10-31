-- 161 — one balance, several earn sources: purchase · ad_reward · activity.
--
-- WHY
-- `entitlement_balance_ledger` already was the single source of truth for a consumable balance, but
-- only ONE thing could credit it: a store/PSP purchase webhook (160/157). That made every other way
-- a user can legitimately acquire currency unrepresentable, so the first consumer kept its OWN
-- ledger and the SDK drained one into the other. Two ledgers for one currency is the defect: the
-- user sees the host's number, the server holds a different one, and an ad reward has no home in
-- either without picking a side.
--
-- This migration makes the server's ledger able to hold every source, so the host keeps none:
--
--   purchase    store / PSP webhook           (157, 160)   — money
--   ad_reward   ad-network server callback    (THIS)       — attention, server-VERIFIED
--   activity    the app's own earn events     (THIS)       — in-app effort (focus minutes, streaks)
--   spend       client spend                  (159)
--   refund / adjustment                        (157)        — support + ops
--
-- ── THE DANGEROUS ONE ────────────────────────────────────────────────────────────────────────────
-- `activity` is CLIENT-ASSERTED by construction. No server can observe that a user focused for 25
-- minutes; only the app can say so. A client-callable credit is therefore a MINT, and a modified
-- client can claim any number it likes. That is not a reason to refuse the source — it is the
-- reason the cap lives HERE rather than in the app:
--
--   * per-(tenant, sku) daily ceiling, declared by the tenant in `tenant_products.daily_earn_cap`;
--   * the ceiling is enforced inside the SECURITY DEFINER function, where the client cannot reach;
--   * over-cap is CLAMPED, not rejected — an honest user at their ceiling must not see an error,
--     and a dishonest one gains nothing by retrying;
--   * every credit still carries the caller's idempotency key, so a replayed earn is a no-op.
--
-- `ad_reward` is deliberately NOT client-callable. An ad network's server-side-verification callback
-- credits it via service_role (the SSV edge function). A client that could assert "I watched an ad"
-- is minting currency with no attention actually sold — the same shape as the subject-id hole 159
-- closed. The two ad surfaces are also NOT the same thing and must not be merged: `PayCraftAdUnlock`
-- grants a TIME-BOXED FEATURE unlock and is deliberately local-only, because a free feature has no
-- transferable value. Currency does.
--
-- Idempotent: every statement is CREATE OR REPLACE / IF NOT EXISTS / guarded DO block.

-- ── 1. the ledger must accept the new reasons ───────────────────────────────────────────────────
-- Drop + re-add rather than ALTER: a CHECK constraint cannot be widened in place.
ALTER TABLE public.entitlement_balance_ledger
  DROP CONSTRAINT IF EXISTS entitlement_balance_ledger_reason_check;

ALTER TABLE public.entitlement_balance_ledger
  ADD CONSTRAINT entitlement_balance_ledger_reason_check
  CHECK (reason IN ('purchase','spend','refund','adjustment','ad_reward','activity'));

COMMENT ON COLUMN public.entitlement_balance_ledger.reason IS
  'How the delta arose. purchase=store/PSP webhook · ad_reward=ad-network SSV callback '
  '(service_role only) · activity=the app''s own earn event (client-asserted, capped) · '
  'spend=client spend · refund/adjustment=support + ops.';

-- ── 2. the tenant declares what an app may mint per day ─────────────────────────────────────────
-- NULL = this sku cannot be earned by activity at all (the safe default for every existing row).
ALTER TABLE public.tenant_products
  ADD COLUMN IF NOT EXISTS daily_earn_cap INT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_products_daily_earn_cap_positive'
  ) THEN
    ALTER TABLE public.tenant_products
      ADD CONSTRAINT tenant_products_daily_earn_cap_positive
      CHECK (daily_earn_cap IS NULL OR daily_earn_cap >= 1);
  END IF;
END $$;

COMMENT ON COLUMN public.tenant_products.daily_earn_cap IS
  'Max units this sku may be credited by reason=activity per subject per UTC day. NULL means '
  'activity earning is DISABLED for this sku — the safe default, because enabling it lets a '
  'modified client mint up to this number.';

-- ── 3. how much has this subject already earned by activity today ───────────────────────────────
CREATE OR REPLACE FUNCTION public.entitlement_activity_earned_today(
    p_tenant_id  UUID,
    p_subject_id UUID,
    p_sku        TEXT
)
RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(delta), 0)::INT
  FROM entitlement_balance_ledger
  WHERE tenant_id  = p_tenant_id
    AND subject_id = p_subject_id
    AND sku        = p_sku
    AND reason     = 'activity'
    AND occurred_at >= date_trunc('day', now() AT TIME ZONE 'utc');
$$;

-- ── 4. CLIENT-FACING activity credit ────────────────────────────────────────────────────────────
-- Same auth shape as 159: tenant from the publishable key, subject from the device token. Neither
-- is a caller-supplied id, so a client can only ever credit ITSELF.
CREATE OR REPLACE FUNCTION public.entitlement_balance_earn(
    p_server_token    TEXT,
    p_api_key         TEXT,
    p_sku             TEXT,
    p_quantity        INT,
    p_idempotency_key TEXT
)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant   UUID;
  v_subject  UUID;
  v_cap      INT;
  v_earned   INT;
  v_grant    INT;
BEGIN
  IF p_quantity IS NULL OR p_quantity < 1 THEN
    RAISE EXCEPTION 'quantity must be >= 1' USING ERRCODE = 'check_violation';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key is required' USING ERRCODE = 'null_value_not_allowed';
  END IF;

  v_tenant := resolve_tenant(p_api_key);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'unknown or inactive api key' USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  v_subject := entitlement_subject_of_token(p_server_token, v_tenant);
  -- Loud, like spend: a credit silently going nowhere would show the user units they do not have.
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'unknown or inactive device token' USING ERRCODE = 'invalid_authorization_specification';
  END IF;

  SELECT daily_earn_cap INTO v_cap
  FROM tenant_products
  WHERE tenant_id = v_tenant AND sku = p_sku AND active;

  -- NULL cap = activity earning not enabled for this sku. Refuse rather than mint: a tenant that
  -- never opted in must not be creditable just because a client asked.
  IF v_cap IS NULL THEN
    RAISE EXCEPTION 'sku % does not allow activity earning (set tenant_products.daily_earn_cap)', p_sku
      USING ERRCODE = 'check_violation';
  END IF;

  v_earned := entitlement_activity_earned_today(v_tenant, v_subject, p_sku);

  -- CLAMP, never reject. An honest user who hits the ceiling mid-session should see their balance
  -- stop rising, not an error dialog; a dishonest one gains nothing by retrying.
  v_grant := LEAST(p_quantity, GREATEST(v_cap - v_earned, 0));

  IF v_grant > 0 THEN
    INSERT INTO entitlement_balance_ledger
      (tenant_id, subject_id, sku, delta, reason, stable_txn_id, idempotency_key)
    VALUES
      (v_tenant, v_subject, p_sku, v_grant, 'activity', NULL, btrim(p_idempotency_key))
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;
  END IF;

  RETURN public.entitlement_balance_get(p_api_key, v_subject, p_sku);
END;
$$;

-- ── 5. SERVICE-ROLE ad reward ───────────────────────────────────────────────────────────────────
-- Takes a subject id, NOT a device token, and is never granted to a client: the caller is the SSV
-- edge function, which has already verified the ad network's signature. There is deliberately no
-- client-callable overload — see the header.
CREATE OR REPLACE FUNCTION public.entitlement_balance_ad_reward(
    p_tenant_id       UUID,
    p_subject_id      UUID,
    p_sku             TEXT,
    p_quantity        INT,
    p_idempotency_key TEXT
)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_quantity IS NULL OR p_quantity < 1 THEN
    RAISE EXCEPTION 'quantity must be >= 1' USING ERRCODE = 'check_violation';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key is required' USING ERRCODE = 'null_value_not_allowed';
  END IF;

  INSERT INTO entitlement_balance_ledger
    (tenant_id, subject_id, sku, delta, reason, stable_txn_id, idempotency_key)
  VALUES
    (p_tenant_id, p_subject_id, p_sku, p_quantity, 'ad_reward', NULL, btrim(p_idempotency_key))
  ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;

  -- Same helper entitlement_balance_grant returns through (157) — tenant+subject shaped, which is
  -- what this function holds. No EXCEPTION fallback: swallowing undefined_function here would turn
  -- a missing dependency into a NULL balance the caller cannot distinguish from "zero units".
  RETURN public.entitlement_balance_of_tenant(p_tenant_id, p_subject_id, p_sku);
END;
$$;

-- ── 6. grants ───────────────────────────────────────────────────────────────────────────────────
GRANT EXECUTE ON FUNCTION public.entitlement_balance_earn(TEXT, TEXT, TEXT, INT, TEXT) TO anon, authenticated;

-- Never client-reachable: an ad reward is only as trustworthy as the signature the SSV callback
-- checked, and a client has no signature to offer.
REVOKE EXECUTE ON FUNCTION public.entitlement_balance_ad_reward(UUID, UUID, TEXT, INT, TEXT) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.entitlement_balance_ad_reward(UUID, UUID, TEXT, INT, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.entitlement_activity_earned_today(UUID, UUID, TEXT) FROM anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.entitlement_activity_earned_today(UUID, UUID, TEXT) TO service_role;

COMMENT ON FUNCTION public.entitlement_balance_earn(TEXT, TEXT, TEXT, INT, TEXT) IS
  'CLIENT-FACING activity earn. Tenant from the publishable key, subject from the device token. '
  'Clamped to tenant_products.daily_earn_cap per subject per UTC day; a NULL cap means this sku '
  'cannot be earned by activity at all. Idempotent on the caller''s key.';
COMMENT ON FUNCTION public.entitlement_balance_ad_reward(UUID, UUID, TEXT, INT, TEXT) IS
  'SERVICE-ROLE ad reward. Called ONLY by the ad-network server-side-verification callback, which '
  'has already checked the network''s signature. Deliberately has no client-callable overload.';
