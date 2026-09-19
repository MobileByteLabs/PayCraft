-- 120_pricing_ensure_served_locales.sql
--
-- A SERVED country with no price row is a silent currency swap.
--
-- `tenant_providers.supported_locales` declares the countries a provider transacts in — razorpay
-- declares {IN}. When `tenant_pricing` has no row for such a country, the config function has
-- nothing country-specific to serve, so the buyer is quoted the tenant's BASE currency instead.
-- Nothing errors; the drift detector (class 5) is the only thing that notices, and its remedy was a
-- manual "add IN pricing on the product's Pricing tab" per product per country.
--
-- This makes the default EXPLICIT rather than implicit: every served locale gets a real row, at the
-- product's base amount, in a caller-chosen currency (USD by default). The buyer is then quoted USD
-- because a row says so, not because a lookup missed.
--
-- WHY `source = 'fallback'` AND NOT 'manual'
-- The enum is (manual, stripe, razorpay, fallback). A row this function writes was NOT authored by
-- a merchant, and labelling it 'manual' would make a generated default indistinguishable from a
-- deliberate price — so a later real price could never be told apart from this, and an audit could
-- not answer "did anyone actually choose this number?". 'fallback' says what it is.
--
-- IDEMPOTENT + NON-DESTRUCTIVE: only inserts where no row exists for (product, locale). A merchant
-- price — of any source, including an earlier fallback they since edited — is never overwritten.
-- That matters because this runs from the sync drain, which operators press repeatedly.

CREATE OR REPLACE FUNCTION public.tenant_pricing_ensure_served_locales(
  p_tenant_id       uuid,
  p_default_currency text DEFAULT 'USD'
)
RETURNS TABLE(product_sku text, locale text, currency text, amount_cents integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
-- The RETURNS TABLE columns (locale, currency, amount_cents) share names with the columns this
-- query reads, and PL/pgSQL resolves the OUT parameter first — 'column reference "locale" is
-- ambiguous'. Prefer the column; nothing here reads an OUT param by name.
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  WITH served AS (
    -- Every country any active provider declares it serves.
    SELECT DISTINCT unnest(tp.supported_locales) AS loc
    FROM tenant_providers tp
    WHERE tp.tenant_id = p_tenant_id
      AND tp.is_active
      AND tp.supported_locales IS NOT NULL
  ),
  needed AS (
    SELECT p.id AS product_id, p.sku, s.loc, p.base_price_cents
    FROM tenant_products p
    CROSS JOIN served s
    WHERE p.tenant_id = p_tenant_id
      AND p.active
      AND NOT EXISTS (
        SELECT 1 FROM tenant_pricing pr
        WHERE pr.tenant_id = p_tenant_id
          AND pr.product_id = p.id
          AND pr.locale = s.loc
      )
  ),
  ins AS (
    INSERT INTO tenant_pricing (tenant_id, product_id, locale, amount_cents, currency, source, source_ref)
    SELECT p_tenant_id, n.product_id, n.loc, n.base_price_cents, upper(p_default_currency),
           'fallback'::pricing_source, 'ensure_served_locales'
    FROM needed n
    RETURNING product_id, locale, currency, amount_cents
  )
  SELECT p.sku, i.locale, i.currency, i.amount_cents
  FROM ins i JOIN tenant_products p ON p.id = i.product_id
  ORDER BY p.display_order, i.locale;
END;
$function$;

-- anon must never reach it (it writes pricing); the dashboard calls it as the signed-in owner and
-- the sync drain calls it as service_role.
REVOKE EXECUTE ON FUNCTION public.tenant_pricing_ensure_served_locales(uuid, text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.tenant_pricing_ensure_served_locales(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.tenant_pricing_ensure_served_locales(uuid, text) IS
  'Insert an explicit price row (base amount, given currency, source=fallback) for every '
  'provider-served locale that has none. Idempotent; never overwrites an existing row.';
