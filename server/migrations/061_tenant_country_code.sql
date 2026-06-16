-- Migration 061 — merchant country tagging for region-aware UX.
--
-- Drives the provider recommendation UI on /providers (and the routing
-- engine's default rule selection). When the merchant is in India, the
-- dashboard surfaces UPI Direct + Razorpay first; when in US/CA/MX, Stripe
-- takes the top slot; in EU, Stripe + Mollie; etc. The chosen country also
-- becomes the FALLBACK customer country when the SDK doesn't pass one (the
-- merchant's own market is the most common audience).
--
-- Pure annotation: NULL = unset, will trigger an onboarding nudge on first
-- /providers visit. ISO 3166-1 alpha-2 only — checked at the API boundary.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS country_code TEXT;

-- Lightweight sanity constraint: 2-letter uppercase. We don't enum-check
-- here because Supabase environments may seed tenants in test data with
-- regions we don't have provider coverage for yet — keep storage liberal,
-- enforce business rules in the application layer where we have richer
-- error messages.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'tenants_country_code_format'
  ) THEN
    ALTER TABLE public.tenants
      ADD CONSTRAINT tenants_country_code_format
      CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$');
  END IF;
END $$;

COMMENT ON COLUMN public.tenants.country_code IS
  'ISO 3166-1 alpha-2 of the merchant''s primary market. NULL = unset (UI prompts on next visit). Used by /providers to surface region-appropriate providers and by checkout-router as the customer-country fallback.';

-- RPC to update it — same auth model as other tenant settings (admin-only).
CREATE OR REPLACE FUNCTION public.tenants_set_country_code(
  p_tenant_id    UUID,
  p_country_code TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Normalise + reject obviously bogus values (the CHECK constraint will
  -- catch the rest).
  IF p_country_code IS NOT NULL AND p_country_code !~ '^[A-Za-z]{2}$' THEN
    RAISE EXCEPTION 'country_code must be a 2-letter ISO 3166-1 alpha-2 code';
  END IF;

  UPDATE tenants
  SET country_code = UPPER(p_country_code),
      updated_at = NOW()
  WHERE id = p_tenant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenants_set_country_code(uuid, text) TO authenticated;
