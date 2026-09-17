-- 094_revoke_anon_unguarded_writers.sql
--
-- Closes the second tranche of anon-executable SECURITY DEFINER writers. Migration 091 closed five;
-- this closes fourteen more — every remaining writer that carries NO internal authorisation check.
--
-- WHY THESE FOURTEEN, AND NOT THE 57 A NAIVE SCAN REPORTS
-- A raw grep for "SECURITY DEFINER + a write statement + no REVOKE" returns 57 functions. That
-- number is wrong three times over, and acting on it would have caused an outage:
--
--   1. Schema qualification. `tenant_products_upsert` and `public.tenant_products_upsert` are the
--      SAME function. 091 revoked the qualified spelling, so three already-fixed functions appear
--      unprotected to a scan that does not normalise the prefix.
--   2. Internal guards. 34 of the writers resolve the caller's tenant from an api_key/server token
--      or auth.uid() before touching a row. They are anon-EXECUTABLE but not anon-EXPLOITABLE, and
--      revoking them breaks the legitimate SDK/dashboard paths that depend on exactly that shape.
--   3. Misclassification. `is_premium_by_app_user` was flagged a writer because a regex captured a
--      neighbouring backfill UPDATE from the same migration file. It is `LANGUAGE sql STABLE` with
--      a single SELECT — it cannot write at all.
--
-- What remains after those three corrections is this list: writers whose tenant scope comes from a
-- CALLER-SUPPLIED argument with nothing verifying the caller may act for that tenant.
--
-- THE WORST OF THEM
--   tenant_stripe_connect_upsert(p_tenant_id, p_account_id, p_access_token, ...) writes a tenant's
--   Stripe Connect credentials. tenant_id is a plain parameter and there is no guard, so any holder
--   of the PUBLIC anon key could overwrite ANY tenant's Stripe account and access token — pointing
--   a victim tenant's payouts at an attacker-controlled account.
--   upgrade_tenant_plan(p_tenant_id, p_plan) escalates a tenant's billing tier the same way.
--
-- WHY THE GRANT INCLUDES `authenticated`
-- dashboard/lib/supabase-server.ts builds its client with NEXT_PUBLIC_SUPABASE_ANON_KEY plus the
-- user's session cookie, so dashboard server routes reach PostgREST as `authenticated`, NOT as
-- `service_role`. Granting service_role alone would have broken every dashboard write path. This is
-- the same reasoning 091 applied, and it is verified per-function below rather than assumed.
--
-- RESIDUAL RISK, STATED PLAINLY — this migration does NOT fully solve authorisation.
-- Revoking anon closes the UNAUTHENTICATED hole: a stranger with the public anon key can no longer
-- call these. It does NOT stop a LOGGED-IN user from passing another tenant's UUID, because these
-- functions still take tenant_id on trust. The complete fix is a tenant guard inside each body
-- (the shape the other 34 already use). That is a larger change with real regression surface, so it
-- is tracked as follow-up rather than smuggled into a REVOKE migration. Closing the anon hole first
-- is strictly better than leaving both open, and matches the scope precedent set by 091.
--
-- Idempotent: REVOKE/GRANT on an absent privilege is a no-op, so this is safe to re-apply.

-- ── Called by dashboard server routes with the session (authenticated) client ────────────────
REVOKE EXECUTE ON FUNCTION public.audit_log_emit(UUID, UUID, TEXT, TEXT, TEXT, JSONB, JSONB, INET, TEXT) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_tenant_entitlements(UUID)                  FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tenant_coupons_set_stripe_ids(UUID, TEXT, TEXT)    FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tenant_paywall_ensure_default(UUID)                FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tenant_products_set_discount_coupon_id(UUID, TEXT) FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.audit_log_emit(UUID, UUID, TEXT, TEXT, TEXT, JSONB, JSONB, INET, TEXT) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.refresh_tenant_entitlements(UUID)                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tenant_coupons_set_stripe_ids(UUID, TEXT, TEXT)    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tenant_paywall_ensure_default(UUID)                TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tenant_products_set_discount_coupon_id(UUID, TEXT) TO authenticated, service_role;

-- ── Called ONLY by Edge Functions, which run as service_role ─────────────────────────────────
-- No `authenticated` grant: no dashboard or SDK path reaches these, so widening beyond
-- service_role would re-open surface for no caller's benefit.
REVOKE EXECUTE ON FUNCTION public.rate_limit_check(UUID, TEXT, INT, NUMERIC)         FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.record_otp_send()                                  FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tenant_coupons_increment_redeemed(TEXT)            FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tenant_stripe_connect_upsert(UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT) FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.upgrade_tenant_plan(UUID, TEXT)                    FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.rate_limit_check(UUID, TEXT, INT, NUMERIC)          TO service_role;
GRANT EXECUTE ON FUNCTION public.record_otp_send()                                   TO service_role;
GRANT EXECUTE ON FUNCTION public.tenant_coupons_increment_redeemed(TEXT)             TO service_role;
GRANT EXECUTE ON FUNCTION public.tenant_stripe_connect_upsert(UUID, TEXT, TEXT, TEXT, BOOLEAN, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.upgrade_tenant_plan(UUID, TEXT)                     TO service_role;

-- ── No caller anywhere in SDK, dashboard, or Edge Functions ──────────────────────────────────
-- Maintenance/cron/internal helpers. service_role only; if one of these later needs a dashboard
-- caller, the GRANT is a one-line follow-up made deliberately rather than inherited by default.
REVOKE EXECUTE ON FUNCTION public.enforce_subscriber_cap(UUID)                       FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.grace_check_emit_alerts()                          FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tenant_audit_log_purge_stale()                     FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.tenant_stripe_connect_disconnect(UUID)             FROM anon, PUBLIC;

GRANT EXECUTE ON FUNCTION public.enforce_subscriber_cap(UUID)                        TO service_role;
GRANT EXECUTE ON FUNCTION public.grace_check_emit_alerts()                           TO service_role;
GRANT EXECUTE ON FUNCTION public.tenant_audit_log_purge_stale()                      TO service_role;
GRANT EXECUTE ON FUNCTION public.tenant_stripe_connect_disconnect(UUID)              TO service_role;

-- NOT revoked, deliberately — the SDK calls these with the anon key by design and they carry their
-- own server-token guards: is_premium, check_premium_with_device, register_device, revoke_device,
-- transfer_to_device, get_active_devices. Revoking them would break entitlement checks in every
-- shipped consumer app. is_premium_by_app_user is likewise left alone: it is a STABLE read, never a
-- writer (see note 3 above).
