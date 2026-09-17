-- Migration 062 — UPI Direct reconciliation ledger.
--
-- UPI Direct payments bypass every payment service provider — money lands
-- directly in the merchant's bank, but PayCraft has no automatic signal
-- that the transfer happened. Without a reconciliation surface the operator
-- has no way to flip a customer's subscription to active.
--
-- This table tracks every UPI checkout INTENT we generate. The flow:
--
--   1. Customer picks UPI Direct at checkout. SDK calls a `create intent`
--      endpoint which inserts a row here (status='pending') with the
--      reference printed into the upi://pay?tr=… deep link.
--   2. Customer pays via their UPI app. NPCI sends an SMS / push to the
--      merchant's phone with the reference number.
--   3. Merchant opens the dashboard's "Pending UPI payments" page, finds
--      the matching reference, clicks "Mark as paid" → we flip
--      status='paid', create a subscriptions row, and emit an audit log
--      entry.
--   4. (Future) Polling mode reads the merchant's bank statement via API
--      and auto-matches references. PSP-webhook mode listens on a
--      Razorpay/Cashfree endpoint even though the transfer itself is
--      direct (the PSP can issue a UPI mandate that triggers a notification
--      we can act on).
--
-- Intents auto-expire after 24h since UPI deep links are bounded by the
-- customer's session window. Expired intents stay in the table for audit
-- but are filtered from the active reconciliation queue.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'upi_intent_status') THEN
    CREATE TYPE upi_intent_status AS ENUM ('pending', 'paid', 'abandoned', 'expired');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.upi_payment_intents (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_id          UUID NOT NULL REFERENCES tenant_products(id) ON DELETE CASCADE,
  -- The reference embedded in the upi://pay?tr=… URL. UNIQUE per tenant —
  -- two intents for the same (tenant, reference) is a generator bug, not a
  -- legitimate state, so enforce at the DB level.
  reference           TEXT NOT NULL,
  -- Snapshot of merchant config at the time of intent creation. If the
  -- merchant later changes their VPA, in-flight intents still resolve
  -- against the original VPA. The bank notification carries the receiver
  -- VPA so the merchant can double-check.
  vpa                 TEXT NOT NULL,
  vpa_display_name    TEXT,
  amount_paise        INT NOT NULL,
  currency            TEXT NOT NULL DEFAULT 'INR',
  customer_email      TEXT,         -- when SDK supplies it
  customer_name       TEXT,         -- when SDK supplies it
  status              upi_intent_status NOT NULL DEFAULT 'pending',
  -- Subscription row created when the merchant marks paid. NULL until then.
  subscription_id     UUID,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at             TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  -- Operator-supplied note when marking paid (UTR / transaction id from
  -- bank notification, to ease later audit).
  bank_transaction_id TEXT,
  notes               TEXT,
  CONSTRAINT upi_payment_intents_tenant_reference_uniq
    UNIQUE (tenant_id, reference),
  CONSTRAINT amount_positive CHECK (amount_paise > 0)
);

CREATE INDEX IF NOT EXISTS idx_upi_intents_tenant_status
  ON public.upi_payment_intents (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_upi_intents_tenant_reference
  ON public.upi_payment_intents (tenant_id, reference);

ALTER TABLE public.upi_payment_intents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "upi_payment_intents_admin_select" ON public.upi_payment_intents;
CREATE POLICY "upi_payment_intents_admin_select" ON public.upi_payment_intents
  FOR SELECT
  USING (tenant_id IN (SELECT tenant_id FROM tenant_admins WHERE user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- RPC: create a new intent. Called from the customer-facing checkout flow
-- when the SDK records "customer chose UPI Direct, here's the reference
-- they'll see in their app". The SDK passes the SAME reference that's in
-- the upi://pay?tr=… URL so reconciliation is straightforward.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upi_payment_intent_create(
  p_tenant_id        UUID,
  p_product_id       UUID,
  p_reference        TEXT,
  p_vpa              TEXT,
  p_vpa_display_name TEXT,
  p_amount_paise     INT,
  p_customer_email   TEXT DEFAULT NULL,
  p_customer_name    TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  -- Called from server-side SDK gateway code via service_role — no auth.uid()
  -- check, but we DO verify the product belongs to the tenant.
  IF NOT EXISTS (
    SELECT 1 FROM tenant_products
    WHERE id = p_product_id AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'product % does not belong to tenant %', p_product_id, p_tenant_id;
  END IF;

  INSERT INTO upi_payment_intents (
    tenant_id, product_id, reference, vpa, vpa_display_name,
    amount_paise, customer_email, customer_name
  ) VALUES (
    p_tenant_id, p_product_id, p_reference, p_vpa, p_vpa_display_name,
    p_amount_paise, p_customer_email, p_customer_name
  )
  ON CONFLICT (tenant_id, reference) DO UPDATE
    SET amount_paise = EXCLUDED.amount_paise,
        customer_email = EXCLUDED.customer_email,
        customer_name = EXCLUDED.customer_name,
        -- Restart the expiry clock — same customer reloading the checkout
        -- page shouldn't immediately mark them expired.
        expires_at = NOW() + INTERVAL '24 hours'
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upi_payment_intent_create(uuid, uuid, text, text, text, int, text, text) TO service_role, authenticated;

-- ---------------------------------------------------------------------------
-- RPC: mark intent paid. Called from the dashboard's reconciliation page
-- after the operator confirms the payment landed (via bank SMS / push).
-- Creates a corresponding `subscriptions` row using handle_subscription_event
-- conventions so the SDK's existing isPremium() check works without changes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upi_payment_intent_mark_paid(
  p_intent_id            UUID,
  p_bank_transaction_id  TEXT DEFAULT NULL,
  p_notes                TEXT DEFAULT NULL,
  p_customer_email       TEXT DEFAULT NULL
)
RETURNS TABLE (
  intent_id       UUID,
  subscription_id UUID,
  product_sku     TEXT
)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_intent       upi_payment_intents%ROWTYPE;
  v_product      tenant_products%ROWTYPE;
  v_sub_id       UUID;
  v_email        TEXT;
  v_period_end   TIMESTAMPTZ;
BEGIN
  SELECT * INTO v_intent FROM upi_payment_intents WHERE id = p_intent_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'intent not found'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins
    WHERE tenant_id = v_intent.tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF v_intent.status = 'paid' THEN
    RAISE EXCEPTION 'intent already marked paid';
  END IF;

  SELECT * INTO v_product FROM tenant_products WHERE id = v_intent.product_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'product missing'; END IF;

  v_email := COALESCE(p_customer_email, v_intent.customer_email);
  IF v_email IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'customer_email required — supply via the dashboard form or the intent itself';
  END IF;

  -- Compute period_end based on product type/interval. Lifetime/one-time
  -- get a far-future date; subscriptions get +1 cycle. Trial uses
  -- trial_duration_days.
  v_period_end := CASE
    WHEN v_product.type = 'lifetime' THEN NOW() + INTERVAL '100 years'
    WHEN v_product.type = 'trial'
      THEN NOW() + (COALESCE(v_product.trial_duration_days, 7) || ' days')::INTERVAL
    WHEN v_product.interval = 'month' THEN NOW() + INTERVAL '1 month'
    WHEN v_product.interval = 'quarter' THEN NOW() + INTERVAL '3 months'
    WHEN v_product.interval = 'semiannual' THEN NOW() + INTERVAL '6 months'
    WHEN v_product.interval = 'year' THEN NOW() + INTERVAL '1 year'
    ELSE NOW() + INTERVAL '1 month'
  END;

  -- Insert / upsert the subscription row. Uses email+provider as the
  -- natural key the SDK expects (mirrors handle_subscription_event from
  -- the webhook flow).
  INSERT INTO subscriptions (
    user_email, provider, status, plan, mode,
    current_period_end, customer_id, subscription_id, tenant_id
  ) VALUES (
    v_email, 'direct_upi', 'active', v_product.sku, 'live',
    v_period_end,
    v_intent.vpa,                                 -- customer_id slot — the VPA
    'upi-intent-' || v_intent.id::TEXT,           -- synthetic subscription_id
    v_intent.tenant_id
  )
  ON CONFLICT (user_email, tenant_id) DO UPDATE
    SET status = EXCLUDED.status,
        plan = EXCLUDED.plan,
        current_period_end = EXCLUDED.current_period_end,
        provider = EXCLUDED.provider,
        updated_at = NOW()
  RETURNING id INTO v_sub_id;

  UPDATE upi_payment_intents
  SET status = 'paid',
      paid_at = NOW(),
      bank_transaction_id = p_bank_transaction_id,
      notes = p_notes,
      customer_email = COALESCE(customer_email, p_customer_email),
      subscription_id = v_sub_id
  WHERE id = p_intent_id;

  RETURN QUERY SELECT p_intent_id, v_sub_id, v_product.sku;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upi_payment_intent_mark_paid(uuid, text, text, text) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: abandon intent. For operator cleanup when a customer cancelled,
-- never paid, or chose a different method.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upi_payment_intent_abandon(p_intent_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
BEGIN
  SELECT tenant_id INTO v_tenant_id FROM upi_payment_intents WHERE id = p_intent_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'intent not found'; END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins
    WHERE tenant_id = v_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  UPDATE upi_payment_intents
  SET status = 'abandoned'
  WHERE id = p_intent_id AND status = 'pending';
END;
$$;
GRANT EXECUTE ON FUNCTION public.upi_payment_intent_abandon(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- RPC: list pending intents for reconciliation. Filters out expired by
-- default (run an explicit query for those — they're noise in the active
-- queue).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upi_payment_intents_list(
  p_tenant_id UUID,
  p_status    upi_intent_status DEFAULT 'pending',
  p_limit     INT DEFAULT 100
)
RETURNS TABLE (
  id                  UUID,
  product_id          UUID,
  product_sku         TEXT,
  product_display_name TEXT,
  reference           TEXT,
  vpa                 TEXT,
  vpa_display_name    TEXT,
  amount_paise        INT,
  currency            TEXT,
  customer_email      TEXT,
  customer_name       TEXT,
  status              upi_intent_status,
  subscription_id     UUID,
  bank_transaction_id TEXT,
  created_at          TIMESTAMPTZ,
  paid_at             TIMESTAMPTZ,
  expires_at          TIMESTAMPTZ,
  is_expired          BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins
    WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  SELECT
    i.id, i.product_id, p.sku, p.display_name,
    i.reference, i.vpa, i.vpa_display_name,
    i.amount_paise, i.currency, i.customer_email, i.customer_name,
    i.status, i.subscription_id, i.bank_transaction_id,
    i.created_at, i.paid_at, i.expires_at,
    (i.expires_at < NOW() AND i.status = 'pending') AS is_expired
  FROM upi_payment_intents i
  JOIN tenant_products p ON p.id = i.product_id
  WHERE i.tenant_id = p_tenant_id
    AND i.status = p_status
  ORDER BY i.created_at DESC
  LIMIT p_limit;
END;
$$;
GRANT EXECUTE ON FUNCTION public.upi_payment_intents_list(uuid, upi_intent_status, int) TO authenticated;
