-- Migration 060 — multi-provider routing foundation.
--
-- PayCraft's existing model is single-provider per checkout: tenant_providers
-- holds one row per (provider, mode) with encrypted keys + payment-link
-- URLs. The SDK's config endpoint returns ONE payment URL per product per
-- currency, scoped to whichever provider answered first. That's fine when
-- you have only Stripe, but breaks down when:
--
--   - You want UPI Direct (no PSP) for Indian customers (0% fees vs Stripe
--     cross-border 7.8%)
--   - You add Razorpay specifically for Indian customers (2.3% vs 7.8%)
--   - You add Cashfree as a backup or for different methods
--   - Different products / currencies should route to different methods
--
-- This migration introduces three tables that, together, replace the
-- "single payment URL per product" model with a router that picks the
-- cheapest eligible method per (tenant, product, customer_country, currency)
-- tuple.
--
--   tenant_payment_methods   — non-card / non-PSP methods the merchant has
--                              enabled: UPI VPA, bank transfer details,
--                              future crypto wallets, etc. Cards/PSPs
--                              continue to live in tenant_providers.
--   tenant_routing_rules     — per-(country, currency) priority list:
--                              "for IN customers paying in INR, try
--                              direct_upi → razorpay → stripe"
--   provider_method_registry — global metadata: per-method fee schedule,
--                              supported countries, supports_subscription
--                              flag, supports_one_time flag. Single source
--                              of truth for "what does each method cost".

-- ---------------------------------------------------------------------------
-- 1. provider_method_registry — global, read-only fee + capability table.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.provider_method_registry (
  method                TEXT PRIMARY KEY,           -- e.g. "stripe_card", "direct_upi", "razorpay_upi"
  display_name          TEXT NOT NULL,
  provider              TEXT NOT NULL,              -- "stripe" | "razorpay" | "cashfree" | "direct_upi" | …
  -- Capability flags
  supports_one_time     BOOLEAN NOT NULL DEFAULT TRUE,
  supports_subscription BOOLEAN NOT NULL DEFAULT FALSE,
  -- Geo / currency support
  supported_countries   TEXT[] NOT NULL DEFAULT '{}', -- '{}' = global
  supported_currencies  TEXT[] NOT NULL DEFAULT '{}', -- '{}' = any
  -- Fee schedule — used by router to compare. percent is the multiplier
  -- portion (e.g. 2.9 = 2.9%), fixed_cents is the fixed cost per txn in
  -- the SETTLEMENT currency.
  fee_percent           NUMERIC(5, 3) NOT NULL DEFAULT 0,
  fee_fixed_cents       INT NOT NULL DEFAULT 0,
  -- Cross-border markup applied when customer currency != merchant
  -- settlement currency. Stripe charges 2% FX + 1% cross-border card markup;
  -- Razorpay doesn't apply this for INR-native flows.
  cross_border_markup_percent NUMERIC(5, 3) NOT NULL DEFAULT 0,
  notes                 TEXT,
  -- Sanity: percent must be reasonable (0-15% covers every payment method
  -- in existence; anything higher is a typo).
  CONSTRAINT fee_percent_sane CHECK (fee_percent BETWEEN 0 AND 15),
  CONSTRAINT cross_border_sane CHECK (cross_border_markup_percent BETWEEN 0 AND 5)
);

-- Seed the registry with what we know today. Numbers from each provider's
-- public docs as of 2026; revisit when their pricing changes.
INSERT INTO public.provider_method_registry
  (method, display_name, provider, supports_one_time, supports_subscription,
   supported_countries, supported_currencies, fee_percent, fee_fixed_cents,
   cross_border_markup_percent, notes)
VALUES
  ('stripe_card',     'Stripe — card',         'stripe',     true, true,
   '{}', '{}', 2.9, 30, 1.5,
   'Domestic card 2.9% + $0.30; cross-border adds ~1.5% + 2% FX when currency mismatch.'),
  ('razorpay_card',   'Razorpay — card',       'razorpay',   true, true,
   '{IN}', '{INR}', 2.0, 0, 0,
   'India-domiciled card: 2% flat. International card on Razorpay: 3%. We default to domestic.'),
  ('razorpay_upi',    'Razorpay — UPI',        'razorpay',   true, true,
   '{IN}', '{INR}', 0.5, 0, 0,
   'UPI via Razorpay: ~0.5% (waived under ₹2000). Supports UPI Autopay for subscriptions.'),
  ('direct_upi',      'Direct UPI (no PSP)',   'direct_upi', true, false,
   '{IN}', '{INR}', 0, 0, 0,
   'Customer pays via deep-linked UPI app; settlement directly to merchant bank. 0% fees. NO subscription support — UPI Autopay requires a PSP.'),
  ('cashfree_upi',    'Cashfree — UPI',        'cashfree',   true, true,
   '{IN}', '{INR}', 1.4, 0, 0,
   'Cashfree UPI: 1.4% flat. Cards 1.75-2.5%. Subscription support via UPI Autopay.')
ON CONFLICT (method) DO UPDATE
  SET display_name = EXCLUDED.display_name,
      supports_one_time = EXCLUDED.supports_one_time,
      supports_subscription = EXCLUDED.supports_subscription,
      supported_countries = EXCLUDED.supported_countries,
      supported_currencies = EXCLUDED.supported_currencies,
      fee_percent = EXCLUDED.fee_percent,
      fee_fixed_cents = EXCLUDED.fee_fixed_cents,
      cross_border_markup_percent = EXCLUDED.cross_border_markup_percent,
      notes = EXCLUDED.notes;

GRANT SELECT ON public.provider_method_registry TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. tenant_payment_methods — per-tenant config for non-PSP methods.
--    (PSP methods like stripe_card / razorpay_card derive credentials from
--    tenant_providers; this table covers methods where the merchant needs
--    additional config — UPI VPA, bank account details, etc.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_payment_methods (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  method       TEXT NOT NULL REFERENCES provider_method_registry(method),
  enabled      BOOLEAN NOT NULL DEFAULT TRUE,
  -- Method-specific config (no secrets — secrets go via tenant_providers
  -- which uses pgcrypto). For direct_upi:
  --   { "vpa": "merchant@oksbi", "display_name": "MobileByteSensei",
  --     "merchant_code": "5411" /* optional MCC */,
  --     "verification_mode": "manual" | "polling" | "psp_webhook" }
  config       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, method)
);

CREATE INDEX IF NOT EXISTS idx_tenant_payment_methods_tenant
  ON public.tenant_payment_methods (tenant_id);

ALTER TABLE public.tenant_payment_methods ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_payment_methods_admin_rw" ON public.tenant_payment_methods;
CREATE POLICY "tenant_payment_methods_admin_rw" ON public.tenant_payment_methods
  FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM tenant_admins WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_admins WHERE user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 3. tenant_routing_rules — per-(country, currency, product-type) priority.
--    Empty country / currency = wildcard. The router picks the FIRST
--    matching rule that satisfies all available methods.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tenant_routing_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id       UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Match criteria — NULL means wildcard (matches any).
  country_code    TEXT,                -- ISO 3166-1 alpha-2, e.g. 'IN'
  currency        TEXT,                -- ISO 4217, e.g. 'INR'
  product_type    TEXT,                -- 'subscription' | 'trial' | 'lifetime'
  -- Ordered list of method names; router tries them in order until one is
  -- both enabled (tenant_payment_methods / tenant_providers) AND supports
  -- the product type. Lower priority = tried first.
  priority_methods TEXT[] NOT NULL,
  priority         INT NOT NULL DEFAULT 100,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenant_routing_rules_tenant
  ON public.tenant_routing_rules (tenant_id, priority);

ALTER TABLE public.tenant_routing_rules ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_routing_rules_admin_rw" ON public.tenant_routing_rules;
CREATE POLICY "tenant_routing_rules_admin_rw" ON public.tenant_routing_rules
  FOR ALL
  USING (tenant_id IN (SELECT tenant_id FROM tenant_admins WHERE user_id = auth.uid()))
  WITH CHECK (tenant_id IN (SELECT tenant_id FROM tenant_admins WHERE user_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. RPCs — minimal CRUD for the dashboard. Detailed routing logic lives
--    in the Edge Function (tenant_checkout_route) so it can fetch from
--    Stripe/Razorpay APIs without pinning Postgres connection time.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tenant_payment_methods_upsert(
  p_tenant_id UUID,
  p_method    TEXT,
  p_enabled   BOOLEAN,
  p_config    JSONB
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Validate the method actually exists in the registry — typo guard.
  IF NOT EXISTS (SELECT 1 FROM provider_method_registry WHERE method = p_method) THEN
    RAISE EXCEPTION 'unknown method: %', p_method;
  END IF;

  INSERT INTO tenant_payment_methods (tenant_id, method, enabled, config)
  VALUES (p_tenant_id, p_method, p_enabled, COALESCE(p_config, '{}'::jsonb))
  ON CONFLICT (tenant_id, method) DO UPDATE
    SET enabled    = EXCLUDED.enabled,
        config     = EXCLUDED.config,
        updated_at = NOW()
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.tenant_payment_methods_upsert(uuid, text, boolean, jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.tenant_payment_methods_list(p_tenant_id UUID)
RETURNS TABLE (
  id           UUID,
  method       TEXT,
  display_name TEXT,
  provider     TEXT,
  enabled      BOOLEAN,
  config       JSONB,
  fee_percent  NUMERIC,
  supports_one_time BOOLEAN,
  supports_subscription BOOLEAN
)
LANGUAGE plpgsql SECURITY DEFINER STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN QUERY
  SELECT tpm.id, tpm.method, pmr.display_name, pmr.provider, tpm.enabled,
         tpm.config, pmr.fee_percent, pmr.supports_one_time, pmr.supports_subscription
  FROM tenant_payment_methods tpm
  JOIN provider_method_registry pmr ON pmr.method = tpm.method
  WHERE tpm.tenant_id = p_tenant_id
  ORDER BY pmr.fee_percent ASC, tpm.method;
END;
$$;
GRANT EXECUTE ON FUNCTION public.tenant_payment_methods_list(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.tenant_routing_rules_upsert(
  p_tenant_id        UUID,
  p_country_code     TEXT,
  p_currency         TEXT,
  p_product_type     TEXT,
  p_priority_methods TEXT[],
  p_priority         INT
)
RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Validate every method in the priority list.
  IF EXISTS (
    SELECT 1 FROM unnest(p_priority_methods) AS m
    WHERE m NOT IN (SELECT method FROM provider_method_registry)
  ) THEN
    RAISE EXCEPTION 'priority_methods contains unknown method names';
  END IF;

  INSERT INTO tenant_routing_rules
    (tenant_id, country_code, currency, product_type, priority_methods, priority)
  VALUES
    (p_tenant_id, NULLIF(p_country_code, ''), NULLIF(p_currency, ''),
     NULLIF(p_product_type, ''), p_priority_methods, COALESCE(p_priority, 100))
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.tenant_routing_rules_upsert(uuid, text, text, text, text[], int) TO authenticated;

CREATE OR REPLACE FUNCTION public.tenant_routing_rules_list(p_tenant_id UUID)
RETURNS SETOF tenant_routing_rules
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public
AS $$
  SELECT * FROM tenant_routing_rules
  WHERE tenant_id = p_tenant_id
    AND tenant_id IN (SELECT tenant_id FROM tenant_admins WHERE user_id = auth.uid())
  ORDER BY priority ASC, created_at;
$$;
GRANT EXECUTE ON FUNCTION public.tenant_routing_rules_list(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.tenant_routing_rules_delete(p_id UUID, p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM tenant_routing_rules WHERE id = p_id AND tenant_id = p_tenant_id;
END;
$$;
GRANT EXECUTE ON FUNCTION public.tenant_routing_rules_delete(uuid, uuid) TO authenticated;
