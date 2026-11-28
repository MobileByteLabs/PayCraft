-- 226_exit_offer.sql
--
-- Exit offer: when a buyer closes the paywall, offer a discount FIRST ("50% off for 3 months"); the exit survey
-- follows only if they decline. One coupon per tenant, on by default once a coupon is attached; same cap as the
-- survey (survey_cap_days). Served in /config as exit_survey.exit_offer; claimed through the `winback` function
-- with reasonCode "exit_offer" (no survey answer is recorded for it).

ALTER TABLE public.tenant_exit_survey
  ADD COLUMN IF NOT EXISTS exit_offer_enabled   BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS exit_offer_coupon_id UUID REFERENCES public.tenant_coupons(id) ON DELETE SET NULL;

-- tenant_exit_offer_save — admins of the tenant only (42501). The coupon must be the tenant's and a percent-off
-- coupon (22023 invalid_exit_offer: coupon_unknown / coupon_not_percent). A NULL coupon turns the offer off.
CREATE OR REPLACE FUNCTION public.tenant_exit_offer_save(
  p_tenant_id UUID,
  p_enabled   BOOLEAN,
  p_coupon_id UUID
) RETURNS public.tenant_exit_survey
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pct INT;
  v_row tenant_exit_survey;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF p_coupon_id IS NOT NULL THEN
    SELECT percent_off INTO v_pct FROM tenant_coupons WHERE id = p_coupon_id AND tenant_id = p_tenant_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'invalid_exit_offer: coupon_unknown' USING ERRCODE = '22023';
    END IF;
    IF v_pct IS NULL OR v_pct <= 0 THEN
      RAISE EXCEPTION 'invalid_exit_offer: coupon_not_percent' USING ERRCODE = '22023';
    END IF;
  END IF;
  INSERT INTO tenant_exit_survey (tenant_id, exit_offer_enabled, exit_offer_coupon_id, updated_at)
  VALUES (p_tenant_id, coalesce(p_enabled, true), p_coupon_id, now())
  ON CONFLICT (tenant_id) DO UPDATE SET
    exit_offer_enabled = EXCLUDED.exit_offer_enabled,
    exit_offer_coupon_id = EXCLUDED.exit_offer_coupon_id,
    updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.tenant_exit_offer_save(UUID, BOOLEAN, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_exit_offer_save(UUID, BOOLEAN, UUID) TO authenticated;
