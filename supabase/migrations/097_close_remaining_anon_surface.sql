-- 097_close_remaining_anon_surface.sql
--
-- Finishes the anon-surface sweep. 094/095/096 closed the writers found by reading migration files
-- plus what the first live probe surfaced; this closes what a FULL classification of every remaining
-- anon-executable function found. Each entry below was checked against its real callers
-- (dashboard, Edge Functions, Kotlin SDK) before being revoked.
--
-- ── THE SUBTLEST ONE: a guard that is inert against the caller it must stop ──────────────────
-- tenant_pricing_bulk_upsert carries the 084-style guard:
--     IF auth.uid() IS NOT NULL AND NOT EXISTS (tenant_admins match) THEN RAISE 'forbidden'
-- That `auth.uid() IS NOT NULL AND` prefix exists so service_role (NULL uid) can pass. But ANON
-- ALSO HAS A NULL uid — so for an anonymous caller the condition short-circuits to false, the
-- exception never fires, and the write proceeds. The function looks guarded in review and is wide
-- open in practice.
--
-- This is the general rule the sweep produced: a function using the 084 prefix guard MUST NOT be
-- anon-executable, because its guard deliberately no-ops for NULL uid. The two mechanisms are only
-- safe in combination. (By contrast the 33 functions using the bare `NOT EXISTS(tenant_admins…)`
-- form reject NULL uid correctly, which is why they are left alone.)
--
-- ── HIGHEST SEVERITY: upi_payment_intent_create ─────────────────────────────────────────────
-- It validates that the product belongs to the tenant, but never validates the CALLER. It accepts
-- p_vpa — the payee UPI address. An anonymous caller could therefore create a payment intent
-- against a victim tenant's real product carrying their OWN VPA, and a customer completing that
-- intent pays the attacker. Its own comment states it is called from server-side gateway code via
-- service_role; the grant now matches that intent.
--
-- ── WHAT IS DELIBERATELY LEFT ANON-EXECUTABLE ───────────────────────────────────────────────
-- check_otp_gate(integer DEFAULT 300) — the SDK calls `postgrest.rpc("check_otp_gate")` with NO
--   arguments, which resolves to this overload via the default. Revoking it would break the OTP
--   gate in every shipped consumer app. Verified against PayCraftService.kt:383 and pg_proc
--   defaults, not assumed.
-- claim_platform_owner() — appears unguarded to a tenant_admins-shaped scan, but opens with
--   `IF auth.uid() IS NULL THEN RAISE EXCEPTION 'unauthenticated'`, so anon is already refused.
--   (Its first-caller-wins ownership claim is a separate design question, logged as follow-up,
--   not a privilege bug.)
-- The 10 token/api-key-guarded SDK RPCs (is_premium, register_device, …) — anon-facing BY DESIGN.
--
-- Idempotent; safe to re-apply.

-- ── Dashboard-called: close anon, keep authenticated (the session client's role) ─────────────
-- 4 dashboard/Edge call sites; with anon gone, the 084 guard above becomes effective because every
-- remaining caller has a non-NULL uid.
REVOKE EXECUTE ON FUNCTION public.tenant_pricing_bulk_upsert(uuid, uuid, jsonb)   FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.tenant_pricing_bulk_upsert(uuid, uuid, jsonb)   TO authenticated, service_role;

-- Writes a row keyed by auth.uid(); an anon caller can only write a NULL-keyed row. Dashboard
-- feature, so authenticated is retained.
REVOKE EXECUTE ON FUNCTION public.account_pricing_template_save(integer, jsonb)   FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.account_pricing_template_save(integer, jsonb)   TO authenticated, service_role;
REVOKE EXECUTE ON FUNCTION public.account_pricing_template_get()                  FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.account_pricing_template_get()                  TO authenticated, service_role;

-- ── Server-side only: no dashboard or SDK caller ─────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.upi_payment_intent_create(uuid, uuid, text, text, text, integer, text, text)
  FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.upi_payment_intent_create(uuid, uuid, text, text, text, integer, text, text)
  TO service_role;

-- refresh_analytics() rebuilds three materialized views. Leaving it anon-callable is a free DoS
-- lever: unauthenticated, repeatable, and each call is expensive.
REVOKE EXECUTE ON FUNCTION public.refresh_analytics()                             FROM anon, authenticated, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.refresh_analytics()                             TO service_role;

-- Reveals whether a given email already holds a subscription for a tenant — subscriber enumeration.
REVOKE EXECUTE ON FUNCTION public.check_subscriber_limit(uuid, text, text)        FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.check_subscriber_limit(uuid, text, text)        TO service_role;

-- ── Trigger functions: fired by the table, never called by a client ─────────────────────────
-- Postgres invokes these as part of the triggering statement, not via the caller's EXECUTE
-- privilege, so revoking cannot affect the triggers themselves.
REVOKE EXECUTE ON FUNCTION public.auto_create_alert_prefs()                       FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pc_broadcast_config_change()                    FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.pc_broadcast_entitlement_change()               FROM anon, authenticated, PUBLIC;
