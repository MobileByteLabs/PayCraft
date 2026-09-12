-- 072_entitlement_records.sql — E2 single source of truth for entitlement state.
--
-- The reconciliation engine (supabase/functions/_shared/entitlement-reconcile.ts) UPSERTs
-- exactly ONE normalized record per stable transaction, keyed unique on (provider, stable_txn_id),
-- so duplicate/out-of-order store notifications converge to one row. canonical_state is the
-- Phase-1 sealed SubscriptionState machine (D6): grace = active, billing-retry/hold = inactive.
--
-- Idempotent per PayCraft migration policy (CLAUDE.md): CREATE TABLE/INDEX IF NOT EXISTS,
-- DROP POLICY IF EXISTS before CREATE POLICY — survives `supabase db reset` + partial re-apply.

CREATE TABLE IF NOT EXISTS entitlement_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id     text NOT NULL,
  tenant_id       uuid,
  provider        text NOT NULL,
  product_id      text NOT NULL,
  stable_txn_id   text NOT NULL,          -- Apple originalTransactionId / Play purchaseToken / PSP sub id
  canonical_state text NOT NULL CHECK (canonical_state IN
    ('trial','active','active_non_renewing','in_grace_period',
     'on_billing_retry','paused','expired','cancelled','refunded','pending')),
  expires_at      timestamptz,
  will_renew      boolean NOT NULL DEFAULT false,
  in_grace_until  timestamptz,
  is_sandbox      boolean NOT NULL DEFAULT false,
  latest_event_ts timestamptz NOT NULL,   -- monotonic guard for out-of-order delivery
  raw_store_state jsonb,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_entitlement_txn UNIQUE (provider, stable_txn_id)
);

CREATE INDEX IF NOT EXISTS idx_entitlement_user ON entitlement_records (app_user_id);
CREATE INDEX IF NOT EXISTS idx_entitlement_tenant_user ON entitlement_records (tenant_id, app_user_id);
-- Active-entitlement lookups gate on canonical_state + expiry; index the hot read path.
CREATE INDEX IF NOT EXISTS idx_entitlement_state ON entitlement_records (app_user_id, canonical_state, expires_at);

ALTER TABLE entitlement_records ENABLE ROW LEVEL SECURITY;

-- Only the service role (edge functions / reconciliation engine) writes or reads raw records.
-- Consumer clients read entitlement through the get_subscription/is_premium RPCs, never this table.
DROP POLICY IF EXISTS entitlement_service_all ON entitlement_records;
CREATE POLICY entitlement_service_all ON entitlement_records
  FOR ALL TO service_role USING (true) WITH CHECK (true);
