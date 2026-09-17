-- 108_sdk_missing_rpcs.sql
--
-- Create the two RPCs the SDK has been calling into thin air.
--
-- `PayCraftService` calls `get_entitlements` and `cancel_subscription`; neither existed in the
-- database. PostgREST answered 404, and the SDK's own error handling turned that into silence:
-- `cancelSubscription` catches and returns `false`, so cancellation was a no-op the app reported as
-- "declined" rather than "broken". `getEntitlements` deliberately RETHROWS — correct for its Store5
-- Fetcher, which must see a network failure to serve last-known-good instead of revoking premium —
-- so the entitlement read has been failing every call and the cache has been serving stale forever,
-- which looks exactly like working software until the cache is empty.
--
-- Found by asking which SDK RPC names actually resolve in `pg_proc` while allowlisting the anon
-- surface (107) — the audit that could see them, because it enumerated what the SDK calls rather
-- than what the schema happens to define.
--
-- Both are SDK-facing and therefore anon-executable BY DESIGN, guarded the way every sibling is:
-- `resolve_tenant(p_api_key)` raises on an invalid or inactive key, and every row touched is scoped
-- to the tenant that key resolves to. They are added to the 107 allowlist for the same reason the
-- other seven are on it.

-- ── 1. get_entitlements ──────────────────────────────────────────────────────────────────────
-- The Store5 cache Fetcher's backing call: the ONE canonical reconciled record per (app_user_id,
-- provider, product), already ingested from store notifications by `entitlement-reconcile.ts`.
--
-- Column NAMES here are a wire contract, not an implementation detail — supabase-kt decodes
-- `EntitlementDto` by @SerialName, so a rename silently yields a default-valued DTO rather than an
-- error (`will_renew` would fall to true and `canonical_state` would fail the decode outright).
--
-- Timestamps convert to epoch MILLIS because that is what the DTO's Long fields and the SQLDelight
-- INTEGER columns carry; returning timestamptz would decode to 0 and expire every entitlement.
CREATE OR REPLACE FUNCTION public.get_entitlements(
  p_app_user_id TEXT,
  p_api_key     TEXT
)
RETURNS TABLE (
  app_user_id     TEXT,
  provider        TEXT,
  product_id      TEXT,
  canonical_state TEXT,
  expires_at      BIGINT,
  in_grace_until  BIGINT,
  will_renew      BOOLEAN,
  is_sandbox      BOOLEAN,
  subscription_id TEXT,
  latest_event_ts BIGINT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_tenant_id UUID;
BEGIN
  v_tenant_id := resolve_tenant(p_api_key);   -- raises on an invalid/inactive key

  RETURN QUERY
  SELECT
    er.app_user_id,
    er.provider,
    er.product_id,
    er.canonical_state,
    (EXTRACT(EPOCH FROM er.expires_at)     * 1000)::BIGINT,
    (EXTRACT(EPOCH FROM er.in_grace_until) * 1000)::BIGINT,
    COALESCE(er.will_renew, true),
    COALESCE(er.is_sandbox, false),
    -- The DTO calls it subscription_id; the table stores the provider's stable transaction id,
    -- which is the same identity under a different name.
    er.stable_txn_id,
    COALESCE((EXTRACT(EPOCH FROM er.latest_event_ts) * 1000)::BIGINT, 0)
  FROM entitlement_records er
  WHERE er.app_user_id = p_app_user_id
    AND er.tenant_id IS NOT DISTINCT FROM v_tenant_id
  -- Newest first: the SDK takes firstOrNull(), so ordering decides which record wins when a user
  -- holds several (an upgrade mid-period leaves the superseded row in place).
  ORDER BY er.latest_event_ts DESC NULLS LAST, er.updated_at DESC;
END;
$$;

COMMENT ON FUNCTION public.get_entitlements(TEXT, TEXT) IS
  'SDK: canonical reconciled entitlements for an app_user_id, tenant-scoped by publishable api key. Timestamps are epoch millis (EntitlementDto wire shape).';

-- ── 2. cancel_subscription ───────────────────────────────────────────────────────────────────
-- Returns whether the cancellation was ACCEPTED, which is not the same as "the subscription is now
-- cancelled" — and the distinction is the whole design here.
--
-- For a store-billed subscription (Google Play / App Store) PayCraft genuinely cannot cancel:
-- Apple and Google require the user to do it in the store's own subscription settings, and both
-- forbid an app cancelling on their behalf. Flipping `cancel_at_period_end` locally would make the
-- app claim a cancellation that never reached the store, and the next notification would silently
-- contradict it. So those return FALSE — which the SDK surfaces as "not accepted", the correct cue
-- to deep-link the user into the store instead of showing a false confirmation.
--
-- For PSP-billed subscriptions (Stripe / Razorpay / custom) the request is recorded as
-- `cancel_at_period_end`, the same non-destructive, reversible semantics the column already has.
CREATE OR REPLACE FUNCTION public.cancel_subscription(
  p_provider        TEXT,
  p_subscription_id TEXT,
  p_api_key         TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_tenant_id UUID; v_rows INT;
BEGIN
  v_tenant_id := resolve_tenant(p_api_key);   -- raises on an invalid/inactive key

  IF lower(COALESCE(p_provider,'')) IN ('google_play', 'app_store', 'play', 'appstore') THEN
    RETURN false;   -- store-managed; the app must send the user to the store
  END IF;

  UPDATE subscriptions
     SET cancel_at_period_end = true,
         updated_at           = now()
   WHERE provider_subscription_id = p_subscription_id
     AND lower(provider)          = lower(p_provider)
     AND tenant_id IS NOT DISTINCT FROM v_tenant_id
     -- Cancelling an already-ended subscription is not a cancellation; reporting `true` for it
     -- would tell the app a state change happened when none did.
     --
     -- Excluding TERMINAL states rather than listing active ones: the column currently holds only
     -- 'active' and 'canceled', so any allowlist of active-ish names would be me guessing at a
     -- vocabulary that does not exist yet — and the failure mode of guessing wrong is a live
     -- subscription that silently refuses to cancel. Both spellings of cancelled appear across the
     -- SDK's state vocabulary, so both are excluded.
     AND lower(COALESCE(status,'')) NOT IN ('canceled', 'cancelled', 'expired', 'refunded');

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows > 0;
END;
$$;

COMMENT ON FUNCTION public.cancel_subscription(TEXT, TEXT, TEXT) IS
  'SDK: request cancel-at-period-end for a PSP-billed subscription, tenant-scoped by publishable api key. Returns false for store-billed providers (cancellation is store-managed).';

-- ── 3. Grants — anon BY DESIGN, per the 107 allowlist rationale ──────────────────────────────
-- Written as REVOKE-then-GRANT rather than relying on the default PUBLIC grant: the default is what
-- 103 and 094–097 leaned on, and it is how 81 functions ended up anon-reachable without anyone
-- choosing it. anon appears here because it was decided, not inherited.
REVOKE ALL ON FUNCTION public.get_entitlements(TEXT, TEXT)             FROM PUBLIC;
REVOKE ALL ON FUNCTION public.cancel_subscription(TEXT, TEXT, TEXT)    FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_entitlements(TEXT, TEXT)          TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cancel_subscription(TEXT, TEXT, TEXT) TO anon, authenticated, service_role;
