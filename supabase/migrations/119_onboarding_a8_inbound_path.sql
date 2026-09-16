-- 119 — A8: the inbound path is a chain rung, not an assumption.
--
-- A0..A7 prove the OUTBOUND direction and nothing else: C2 proves the provider answers US, A5 proves
-- the SKU exists AT the provider, A6 proves /config serves the buyer the right paywall. Billing is a
-- two-sided integration, and the other side was never a rung.
--
-- Measured on PayCraft production 2026-09-15, with every one of A0..A7 satisfiable at the time:
--   * Razorpay was posting 53 event types to `…/api/webhooks/razorpay` — a route that has never
--     existed in git history. Every event was dropped.
--   * Stripe had auto-disabled its endpoint after the resulting delivery failures.
--   * Both Edge Functions ran `verify_jwt = true`, so even a correct URL would have answered 401.
--
-- A tenant in that state onboards "successfully", takes a payment, and never flips the subscription
-- row. The buyer is charged and stays un-entitled while every dashboard reads green — the same shape
-- as the six defects in RULE-PAYCRAFT-ONBOARD-NO-SKIP-001: a row existed, so something reported green.
--
-- 117 is applied, so its enum is not edited (see CLAUDE.md — edits to applied migrations are
-- forbidden); the value is appended. ADD VALUE is transaction-safe on PG 12+ as long as the new
-- value is not USED in the same transaction, which is why nothing below references it.

ALTER TYPE onboarding_blocked_reason ADD VALUE IF NOT EXISTS 'pending-webhook-roundtrip';

COMMENT ON TABLE onboarding_app_state IS
  'Per-tenant onboarding progress (A0..A8). Steps carry evidence; the trigger refuses a pass without it. A8 proves the INBOUND path — a webhook that reaches a route that exists, verifies its signature, and writes the subscription row.';
