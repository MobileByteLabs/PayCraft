-- 207: App Store refund requests — answering Apple's CONSUMPTION_REQUEST.
--
-- When a customer asks Apple for a refund, Apple sends a CONSUMPTION_REQUEST notification and gives the developer
-- 12 hours to send consumption information (was the purchase delivered, how much of it was used, how long the
-- customer has been a customer, the developer's refund preference). Apple weighs that answer when deciding the
-- refund; unanswered, it decides on the customer's word alone.
--
-- Apple requires `customerConsented: true` — the developer must have the customer's consent to share this data
-- (normally via the app's privacy policy). PayCraft cannot know that, so it is the tenant's switch, OFF by default:
-- with it off, a request is logged and nothing is sent.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS appstore_consumption_consent BOOLEAN NOT NULL DEFAULT false,
  -- Apple's refundPreference: 0 undeclared · 1 grant the refund · 2 decline it · 3 no preference.
  ADD COLUMN IF NOT EXISTS appstore_refund_preference SMALLINT NOT NULL DEFAULT 0;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenants_appstore_refund_preference_range') THEN
    ALTER TABLE public.tenants ADD CONSTRAINT tenants_appstore_refund_preference_range
      CHECK (appstore_refund_preference BETWEEN 0 AND 3);
  END IF;
END $$;

-- One row per refund request: what was sent (or why nothing was), and Apple's HTTP status. Apple re-sends a
-- notification it did not see acknowledged, so the transaction id is the idempotency key — answered once.
CREATE TABLE IF NOT EXISTS public.appstore_consumption_responses (
  id              BIGSERIAL PRIMARY KEY,
  tenant_id       UUID REFERENCES public.tenants(id) ON DELETE CASCADE,
  transaction_id  TEXT NOT NULL UNIQUE,
  product_id      TEXT,
  outcome         TEXT NOT NULL CHECK (outcome IN ('sent', 'failed', 'no_consent', 'no_credentials')),
  apple_status    INT,
  request         JSONB,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.appstore_consumption_responses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appstore_consumption_responses_service_all ON public.appstore_consumption_responses;
CREATE POLICY appstore_consumption_responses_service_all ON public.appstore_consumption_responses
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS appstore_consumption_responses_admin_read ON public.appstore_consumption_responses;
CREATE POLICY appstore_consumption_responses_admin_read ON public.appstore_consumption_responses
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.tenant_admins ta
             WHERE ta.tenant_id = appstore_consumption_responses.tenant_id AND ta.user_id = auth.uid())
  );
