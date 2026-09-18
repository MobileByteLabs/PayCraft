-- 123: seed BAND pricing (right currency per country), superseding 120's base-currency rows.
CREATE OR REPLACE FUNCTION public.tenant_pricing_ensure_served_locales(
  p_tenant_id uuid,
  p_default_currency text DEFAULT 'USD'   -- retained for signature compat; bands decide the currency
)
RETURNS TABLE(product_sku text, locale text, currency text, amount_cents integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_admins WHERE tenant_id=p_tenant_id AND user_id=auth.uid())
  THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  WITH served AS (
    -- Provider-served countries UNION the major markets, so a product is priced in the big
    -- currencies whether or not a provider has declared that country yet. A provider added later
    -- must never be the reason a price was missing.
    SELECT DISTINCT unnest(tp.supported_locales) AS loc
    FROM tenant_providers tp
    WHERE tp.tenant_id=p_tenant_id AND tp.is_active AND tp.supported_locales IS NOT NULL
    UNION
    SELECT c FROM unnest(ARRAY['US','IN','CA','DE','GB','AU','JP']) c
  ),
  needed AS (
    SELECT p.id AS product_id, p.sku, s.loc, p.base_price_cents, b.currency, b.multiplier, b.round_to, b.zero_decimal
    FROM tenant_products p
    CROSS JOIN served s
    JOIN pricing_bands b ON b.country = s.loc
    WHERE p.tenant_id=p_tenant_id AND p.active
      AND NOT EXISTS (
        SELECT 1 FROM tenant_pricing pr
        WHERE pr.tenant_id=p_tenant_id AND pr.product_id=p.id AND pr.locale=s.loc
      )
  ),
  ins AS (
    INSERT INTO tenant_pricing (tenant_id, product_id, locale, amount_cents, currency, source, source_ref)
    SELECT p_tenant_id, n.product_id, n.loc,
           pricing_charm_round(n.base_price_cents * n.multiplier, n.round_to, n.zero_decimal),
           n.currency, 'fallback'::pricing_source, 'pricing_bands'
    FROM needed n
    RETURNING product_id, locale, currency, amount_cents
  )
  SELECT p.sku, i.locale, i.currency, i.amount_cents
  FROM ins i JOIN tenant_products p ON p.id=i.product_id
  ORDER BY p.display_order, i.locale;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.tenant_pricing_ensure_served_locales(uuid,text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.tenant_pricing_ensure_served_locales(uuid,text) TO authenticated, service_role;
