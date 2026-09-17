-- 090_lifetime_entitlement_semantics.sql — D6: disable hides, it never revokes.
--
-- THE PROMISE THIS LOCKS
-- A merchant flipping tenant_products.active = false is saying "stop selling this", not "take it
-- away from the people who bought it". Those are different operations and conflating them is a
-- refund event, not a bug report. So the entitlement read path below deliberately does NOT join
-- tenant_products.active — there is no code path by which a merchant toggle can revoke a paid
-- entitlement, because the flag is never consulted when answering "is this user entitled".
--
-- Lifetime carries expires_at IS NULL and is honoured indefinitely. Note the ordering in the
-- predicate: NULL is checked FIRST, so a null expiry short-circuits to "current" rather than
-- falling through to a NULL comparison that would evaluate to NULL and read as false.

-- STABLE, not IMMUTABLE: the body calls now(), which is itself STABLE. Labelling it IMMUTABLE
-- would be a lie the planner is entitled to act on — most damagingly, a functional index built on
-- this predicate would freeze each row's verdict at write time and never re-evaluate as time
-- passed, so expired entitlements would keep reading as current. The sibling
-- is_premium_by_app_user is STABLE for the same reason.
CREATE OR REPLACE FUNCTION public.is_entitlement_current(p_state text, p_expires_at timestamptz)
RETURNS boolean LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT p_state IN ('trial','active','active_non_renewing','in_grace_period')
     AND (p_expires_at IS NULL OR p_expires_at > now());
$$;

-- Reads the 072 entitlement_records SoT. Coexists with the legacy
-- is_premium(p_server_token, p_api_key) rather than replacing it — consumers move over in a later
-- phase, and changing an RPC that shipped SDKs already call is its own migration with its own
-- rollout. STABLE + SECURITY DEFINER so an edge function can read immediately post-reconcile.
CREATE OR REPLACE FUNCTION public.is_premium_by_app_user(p_app_user_id text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM entitlement_records
     WHERE app_user_id = p_app_user_id
       AND public.is_entitlement_current(canonical_state, expires_at)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_premium_by_app_user(text) TO service_role, authenticated;

-- ── Backfill: collapse any non-null expiry on a lifetime entitlement to NULL ─────────────
-- entitlement_records.product_id carries the STORE product identifier (the reconcile writes
-- ev.productId at _shared/entitlement-reconcile.ts:71), which is what tenant_products.sku holds.
--
-- TENANT SCOPING (tightened vs. the plan's draft): the join also matches tenant_id where the
-- record carries one. Two tenants can legitimately use the same store SKU string, and an
-- unscoped join would grant tenant B's subscriber a permanent entitlement because tenant A
-- happens to sell that SKU as lifetime. Records with a NULL tenant_id (pre-072 rows) still match
-- on SKU alone — for those there is no tenant to disambiguate by, and leaving a genuine lifetime
-- purchase to age out is the worse of the two errors.
UPDATE entitlement_records er
   SET expires_at = NULL, updated_at = now()
  FROM tenant_products tp
 WHERE tp.type = 'lifetime'
   AND er.product_id = tp.sku
   AND (er.tenant_id IS NULL OR er.tenant_id = tp.tenant_id)
   AND er.expires_at IS NOT NULL;
