-- 181: exit survey + win-back offers (paycraft-paywall-analytics, GOAL D6 / D7).
--
-- When a buyer closes the paywall or leaves checkout, the SDK can ask why (a bottom sheet on mobile, a dialog
-- on the web). This migration holds:
--   · tenant_exit_survey     — the tenant's survey: question, reasons (each: label, on/off, and what happens when
--                              chosen — an offer (a coupon), a message, or nothing), and how often it may be asked.
--                              Every tenant gets the default six reasons; the dashboard's Paywall ▸ Exit survey edits it.
--   · exit_survey_responses  — what buyers answered (free text stays here — it is never sent to GA4, GOAL D10).
--   · winback_offers         — an offer made to one buyer after an answer: one coupon at most once per buyer
--                              (UNIQUE), expiring; applied when checkout carries its discount, redeemed when
--                              the provider confirms payment.
-- Written by the `winback` edge function (service role); tenant admins read their own rows.

CREATE TABLE IF NOT EXISTS public.tenant_exit_survey (
  tenant_id       UUID PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  title           TEXT NOT NULL DEFAULT 'Before you go — what stopped you?' CHECK (length(title) BETWEEN 1 AND 80),
  reasons         JSONB NOT NULL DEFAULT '[
    {"code":"too_expensive","label":"It''s too expensive","enabled":true,"action":"offer","coupon_id":null},
    {"code":"just_looking","label":"I''m just looking","enabled":true,"action":"none"},
    {"code":"payment_method","label":"My payment method isn''t here","enabled":true,"action":"message","message":"You can also pay with UPI, cards and wallets on our website."},
    {"code":"trust","label":"I don''t trust it yet","enabled":true,"action":"message","message":"Cancel any time. Payments are processed securely by the payment provider."},
    {"code":"features","label":"I need more features","enabled":true,"action":"none"},
    {"code":"other","label":"Something else","enabled":true,"action":"none","free_text":true}
  ]'::jsonb CHECK (jsonb_typeof(reasons) = 'array'),
  survey_cap_days INT NOT NULL DEFAULT 7 CHECK (survey_cap_days BETWEEN 1 AND 90),
  offer_hours     INT NOT NULL DEFAULT 48 CHECK (offer_hours BETWEEN 1 AND 720),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.exit_survey_responses (
  id          BIGSERIAL PRIMARY KEY,
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_ref    TEXT,
  device_ref  TEXT,
  step        TEXT NOT NULL CHECK (step ~ '^[a-z][a-z_]{0,30}$'),
  reason_code TEXT NOT NULL CHECK (reason_code ~ '^[a-z][a-z_]{0,30}$'),
  free_text   TEXT CHECK (free_text IS NULL OR length(free_text) <= 500),
  platform    TEXT NOT NULL CHECK (platform IN ('android', 'ios', 'web', 'desktop')),
  country     TEXT CHECK (country IS NULL OR country ~ '^[A-Z]{2}$'),
  sku         TEXT,
  mode        TEXT NOT NULL DEFAULT 'live' CHECK (mode IN ('live', 'test')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exit_survey_responses_tenant_time ON public.exit_survey_responses (tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.winback_offers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_ref    TEXT NOT NULL,
  coupon_id   UUID NOT NULL REFERENCES public.tenant_coupons(id) ON DELETE CASCADE,
  reason_code TEXT NOT NULL,
  sku         TEXT,
  expires_at  TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT winback_offers_once_per_buyer UNIQUE (tenant_id, user_ref, coupon_id)
);
CREATE INDEX IF NOT EXISTS winback_offers_tenant_time ON public.winback_offers (tenant_id, created_at DESC);
-- applied_at: checkout-initiate put the discount on a checkout; redeemed_at: the provider then confirmed payment.
ALTER TABLE public.winback_offers ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ;

-- RLS: service role writes (the winback function, the dashboard's API routes); tenant admins read their own.
ALTER TABLE public.tenant_exit_survey ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exit_survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.winback_offers ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['tenant_exit_survey', 'exit_survey_responses', 'winback_offers'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_service_role', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR ALL
      USING (current_setting('role') = 'service_role') WITH CHECK (current_setting('role') = 'service_role')$p$,
      t || '_service_role', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_tenant_admin_select', t);
    EXECUTE format($p$CREATE POLICY %I ON public.%I FOR SELECT TO authenticated
      USING (tenant_id IN (SELECT ta.tenant_id FROM public.tenant_admins ta WHERE ta.user_id = auth.uid()))$p$,
      t || '_tenant_admin_select', t);
  END LOOP;
END $$;

-- Every tenant has a survey row: the existing ones now, new ones on creation (same pattern as alert prefs, 025).
INSERT INTO public.tenant_exit_survey (tenant_id)
SELECT id FROM public.tenants
ON CONFLICT (tenant_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.auto_create_exit_survey() RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.tenant_exit_survey (tenant_id) VALUES (NEW.id) ON CONFLICT (tenant_id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_auto_exit_survey ON public.tenants;
CREATE TRIGGER trg_auto_exit_survey AFTER INSERT ON public.tenants
  FOR EACH ROW EXECUTE FUNCTION public.auto_create_exit_survey();
