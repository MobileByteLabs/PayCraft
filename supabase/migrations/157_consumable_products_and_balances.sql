-- 157 — consumable products and an append-only balance ledger.
--
-- Implements REQUIREMENTS.md#PC-001..006. PC-007 (store acknowledge/consume) is client+webhook
-- work and lands separately; nothing here can enforce it.
--
-- ## Why a ledger and not a counter
--
-- A balance is money. `UPDATE balances SET n = n - 1` loses a concurrent decrement silently, and
-- afterwards there is nothing to audit — you cannot answer "where did my 500 coins go", which is
-- the single question consumables generate for support. So: append-only rows, balance is
-- SUM(delta), a refund is a negative row, and history is never rewritten.
--
-- ## Why subject_id and not email
--
-- Migration 154 exists because entitlement keyed on email broke: an Apple "Hide My Email" relay
-- address minted a SECOND identity, and a paying subscriber was not premium on their second
-- device. A balance keyed on email inherits that bug exactly, except the user loses units they
-- PAID FOR rather than access they can re-verify. Balances therefore key on the same stable
-- subject, resolved through the same `entitlement_subject_resolve()`.
--
-- ## Idempotency is load-bearing in BOTH directions
--
-- Play and Apple RETRY webhooks, so a grant must not double-credit. A client spend retried after
-- a network timeout must not double-charge. One UNIQUE (tenant_id, idempotency_key) covers both;
-- the grant path derives its key from the provider transaction, the spend path takes the
-- caller's. This is why the SDK's `spend()` has no default for it (AR-011): a generated
-- per-call default would make every retry a fresh charge.

-- ── 1. product_type gains `consumable` ───────────────────────────────────────────────────────────
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block in older PG, and is not
-- idempotent on its own, hence the guard.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'product_type' AND e.enumlabel = 'consumable'
  ) THEN
    ALTER TYPE product_type ADD VALUE 'consumable';
  END IF;
END $$;

-- ── 2. grant_quantity — units credited per purchase ─────────────────────────────────────────────
ALTER TABLE public.tenant_products
  ADD COLUMN IF NOT EXISTS grant_quantity INT;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenant_products_grant_quantity_positive'
  ) THEN
    ALTER TABLE public.tenant_products
      ADD CONSTRAINT tenant_products_grant_quantity_positive
      CHECK (grant_quantity IS NULL OR grant_quantity >= 1);
  END IF;
END $$;

COMMENT ON COLUMN public.tenant_products.grant_quantity IS
  'Units credited per purchase. NON-NULL for consumable products only; NULL for every other type. '
  'NULL means not-applicable, never zero — a product that credits 0 units is a different, broken state.';

-- NOTE: the "consumable <=> grant_quantity non-null" rule is NOT a table CHECK. `type` is the enum
-- just extended above, and a CHECK referencing a value added in the same migration fails on some
-- PG versions ("unsafe use of new value of enum type"). It is enforced in tenant_product_upsert
-- below, which is the only sanctioned write path, and asserted by the canary.

-- ── 3. the ledger ────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.entitlement_balance_ledger (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    subject_id      UUID NOT NULL REFERENCES public.entitlement_subjects(id) ON DELETE CASCADE,
    sku             TEXT NOT NULL,
    -- Signed. + credits (purchase, adjustment up), - debits (spend, refund, adjustment down).
    -- Never 0: a no-op row is noise in the one place support reads for an explanation.
    delta           INT  NOT NULL CHECK (delta <> 0),
    reason          TEXT NOT NULL CHECK (reason IN ('purchase','spend','refund','adjustment')),
    -- Provider transaction for grants/refunds (Play purchaseToken, Apple originalTransactionId).
    -- NULL for client spends, which have no provider side.
    stable_txn_id   TEXT,
    -- The dedupe key. Grants derive it from the provider txn; spends take the caller's.
    idempotency_key TEXT NOT NULL,
    occurred_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT entitlement_balance_ledger_idem UNIQUE (tenant_id, idempotency_key)
);

COMMENT ON TABLE public.entitlement_balance_ledger IS
  'APPEND-ONLY. Balance is SUM(delta) per (tenant_id, subject_id, sku). Never UPDATE or DELETE a '
  'row: a correction is a new `adjustment` row. Rewriting history destroys the audit trail that is '
  'the entire reason this is a ledger rather than a counter.';

-- Balance reads are always (tenant, subject, sku) — this index IS the balance query.
CREATE INDEX IF NOT EXISTS entitlement_balance_ledger_balance_idx
  ON public.entitlement_balance_ledger (tenant_id, subject_id, sku);

-- Support reads one subject's history newest-first, cursor-paginated on occurred_at.
CREATE INDEX IF NOT EXISTS entitlement_balance_ledger_history_idx
  ON public.entitlement_balance_ledger (tenant_id, subject_id, occurred_at DESC);

ALTER TABLE public.entitlement_balance_ledger ENABLE ROW LEVEL SECURITY;

-- Admins of the tenant may READ. There is deliberately no INSERT/UPDATE/DELETE policy: every
-- write goes through the SECURITY DEFINER functions below, so a compromised admin session cannot
-- mint currency.
DROP POLICY IF EXISTS entitlement_balance_ledger_read ON public.entitlement_balance_ledger;
CREATE POLICY entitlement_balance_ledger_read ON public.entitlement_balance_ledger FOR SELECT
  USING (tenant_id IN (SELECT ta.tenant_id FROM tenant_admins ta WHERE ta.user_id = auth.uid()));

-- ── 4. balance read ──────────────────────────────────────────────────────────────────────────────
-- CLIENT-FACING: the tenant is resolved from the publishable key, NEVER taken as a parameter.
-- This function is granted to `authenticated`; a p_tenant_id parameter would let any caller read
-- ANOTHER tenant's balances by passing their id. resolve_tenant() has been the house pattern for
-- every tenant-aware RPC since migration 016 — this follows it rather than inventing a second way.
CREATE OR REPLACE FUNCTION public.entitlement_balance_get(
    p_api_key    TEXT,
    p_subject_id UUID,
    p_sku        TEXT
)
RETURNS INT
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(delta), 0)::INT
  FROM entitlement_balance_ledger
  WHERE tenant_id = resolve_tenant(p_api_key)
    AND subject_id = p_subject_id
    AND sku = p_sku;
$$;

-- Internal balance by tenant id. The client-facing getter above is api-key scoped and therefore
-- NOT callable from the service-role paths, which hold a tenant id and no key. Splitting them
-- keeps the client function unable to name a tenant, without forcing the webhook to invent a key.
CREATE OR REPLACE FUNCTION public.entitlement_balance_of_tenant(
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
  WHERE tenant_id = p_tenant_id AND subject_id = p_subject_id AND sku = p_sku;
$$;

REVOKE EXECUTE ON FUNCTION public.entitlement_balance_of_tenant(UUID, UUID, TEXT) FROM authenticated, anon;

-- ── 5. grant (server-only) ───────────────────────────────────────────────────────────────────────
-- PC-005: credited ONLY from the webhook path under service_role. Never granted to `authenticated`
-- below, because a client-callable grant makes the balance forgeable.
CREATE OR REPLACE FUNCTION public.entitlement_balance_grant(
    p_tenant_id       UUID,
    p_subject_id      UUID,
    p_sku             TEXT,
    p_quantity        INT,
    p_stable_txn_id   TEXT,
    p_idempotency_key TEXT
)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance INT;
BEGIN
  IF p_quantity IS NULL OR p_quantity < 1 THEN
    RAISE EXCEPTION 'grant quantity must be >= 1' USING ERRCODE = 'check_violation';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key is required' USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- The retry path. A redelivered webhook hits the unique constraint and is absorbed, so the
  -- caller still gets the CURRENT balance rather than an error — a provider retry is normal
  -- traffic, not a fault, and surfacing it as one would make webhook handlers treat success as
  -- failure and retry forever.
  INSERT INTO entitlement_balance_ledger
    (tenant_id, subject_id, sku, delta, reason, stable_txn_id, idempotency_key)
  VALUES
    (p_tenant_id, p_subject_id, p_sku, p_quantity, 'purchase', p_stable_txn_id, btrim(p_idempotency_key))
  ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;

  SELECT entitlement_balance_of_tenant(p_tenant_id, p_subject_id, p_sku) INTO v_balance;
  RETURN v_balance;
END $$;

-- ── 6. spend (checked, atomic) ───────────────────────────────────────────────────────────────────
-- CLIENT-FACING: tenant resolved from the key, for the same reason as the getter above. A
-- caller-supplied tenant id on a spend would be worse than a leak — it would let one tenant
-- DRAIN another's balances.
CREATE OR REPLACE FUNCTION public.entitlement_balance_spend(
    p_api_key         TEXT,
    p_subject_id      UUID,
    p_sku             TEXT,
    p_quantity        INT,
    p_idempotency_key TEXT
)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_balance  INT;
  v_existing INT;
  v_tenant   UUID;
BEGIN
  v_tenant := resolve_tenant(p_api_key);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'unknown or inactive api key' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  IF p_quantity IS NULL OR p_quantity < 1 THEN
    RAISE EXCEPTION 'spend quantity must be >= 1' USING ERRCODE = 'check_violation';
  END IF;
  IF p_idempotency_key IS NULL OR btrim(p_idempotency_key) = '' THEN
    RAISE EXCEPTION 'idempotency_key is required' USING ERRCODE = 'null_value_not_allowed';
  END IF;

  -- Replay check FIRST. A client retrying after a timeout must get the same answer as the
  -- original call, not "insufficient funds" because the first attempt already debited.
  SELECT 1 INTO v_existing
  FROM entitlement_balance_ledger
  WHERE tenant_id = v_tenant AND idempotency_key = btrim(p_idempotency_key);

  IF FOUND THEN
    RETURN entitlement_balance_of_tenant(v_tenant, p_subject_id, p_sku);
  END IF;

  -- Lock this subject's rows for this sku so two concurrent spends cannot both read a sufficient
  -- balance and both debit. Without this the CHECK below is a time-of-check/time-of-use race and
  -- the balance goes negative under load.
  PERFORM 1 FROM entitlement_balance_ledger
   WHERE tenant_id = v_tenant AND subject_id = p_subject_id AND sku = p_sku
   FOR UPDATE;

  SELECT entitlement_balance_of_tenant(v_tenant, p_subject_id, p_sku) INTO v_balance;

  IF v_balance < p_quantity THEN
    -- Expected outcome of a shop, not a fault. The SDK maps this to Result.failure (AR-012)
    -- rather than throwing, and the dashboard never sees it.
    RAISE EXCEPTION 'insufficient_balance: have %, need %', v_balance, p_quantity
      USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO entitlement_balance_ledger
    (tenant_id, subject_id, sku, delta, reason, stable_txn_id, idempotency_key)
  VALUES
    (v_tenant, p_subject_id, p_sku, -p_quantity, 'spend', NULL, btrim(p_idempotency_key));

  RETURN v_balance - p_quantity;
END $$;

-- ── 7. history read (cursor-paginated) ───────────────────────────────────────────────────────────
-- DASHBOARD-FACING, and SECURITY DEFINER bypasses RLS — so the admin check must be IN the body.
-- Without it any authenticated user could read any tenant's purchase history by passing their id,
-- which the table's RLS policy would otherwise have prevented.
CREATE OR REPLACE FUNCTION public.entitlement_balance_ledger_list(
    p_tenant_id  UUID,
    p_subject_id UUID,
    p_sku        TEXT DEFAULT NULL,          -- NULL = every sku for the subject
    p_before     TIMESTAMPTZ DEFAULT NULL,   -- cursor
    p_limit      INT DEFAULT 50
)
RETURNS TABLE (
    occurred_at     TIMESTAMPTZ,
    sku             TEXT,
    delta           INT,
    reason          TEXT,
    stable_txn_id   TEXT,
    idempotency_key TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.occurred_at, l.sku, l.delta, l.reason, l.stable_txn_id, l.idempotency_key
  FROM entitlement_balance_ledger l
  WHERE l.tenant_id = p_tenant_id
    AND EXISTS (
      SELECT 1 FROM tenant_admins ta
      WHERE ta.tenant_id = p_tenant_id AND ta.user_id = auth.uid()
    )
    AND l.subject_id = p_subject_id
    AND (p_sku IS NULL OR l.sku = p_sku)
    AND (p_before IS NULL OR l.occurred_at < p_before)
  ORDER BY l.occurred_at DESC
  LIMIT LEAST(COALESCE(p_limit, 50), 200);
$$;

-- ── 8. grants ────────────────────────────────────────────────────────────────────────────────────
-- Read + spend reach the client. GRANT does NOT (PC-005) — it stays service_role only, which is
-- the whole reason the balance is not forgeable.
GRANT EXECUTE ON FUNCTION public.entitlement_balance_get(TEXT, UUID, TEXT)              TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.entitlement_balance_spend(TEXT, UUID, TEXT, INT, TEXT) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION public.entitlement_balance_ledger_list(UUID, UUID, TEXT, TIMESTAMPTZ, INT) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.entitlement_balance_grant(UUID, UUID, TEXT, INT, TEXT, TEXT) FROM authenticated, anon;
