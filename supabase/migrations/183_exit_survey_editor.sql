-- 183_exit_survey_editor.sql
--
-- The dashboard's exit-survey editor (paycraft-paywall-analytics T15, GOAL D6 / AC-11). Tenant admins already READ
-- tenant_exit_survey through RLS (181); this adds the one way to WRITE it, and the database owns the rule for what a
-- survey may contain — whichever writer sends it (dashboard, API, MCP). dashboard/lib/exit-survey-config.ts mirrors
-- these checks for early form errors and returns the same codes (supabase/tests/183_exit_survey_editor_test.sql).
--
-- The rules apply to ENABLED reasons: the default survey ships "too expensive → offer" with no coupon picked (the
-- winback function then gives nothing), and a tenant may keep a reason switched off until its coupon exists.
-- Idempotent (CREATE OR REPLACE).

CREATE OR REPLACE FUNCTION public.exit_survey_problem(
  p_tenant_id   UUID,
  p_title       TEXT,
  p_reasons     JSONB,
  p_cap_days    INT,
  p_offer_hours INT
) RETURNS TEXT
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  r      JSONB;
  v_code TEXT;
  v_on   BOOLEAN;
  codes  TEXT[] := '{}';
  any_on BOOLEAN := false;
BEGIN
  IF p_title IS NULL OR length(btrim(p_title)) = 0 OR length(p_title) > 80 THEN RETURN 'title_1_to_80_chars'; END IF;
  IF p_cap_days IS NULL OR p_cap_days NOT BETWEEN 1 AND 90 THEN RETURN 'cap_days_1_to_90'; END IF;
  IF p_offer_hours IS NULL OR p_offer_hours NOT BETWEEN 1 AND 720 THEN RETURN 'offer_hours_1_to_720'; END IF;
  IF p_reasons IS NULL OR jsonb_typeof(p_reasons) <> 'array' OR jsonb_array_length(p_reasons) NOT BETWEEN 1 AND 12 THEN
    RETURN 'reasons_1_to_12';
  END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(p_reasons) LOOP
    v_code := coalesce(r->>'code', '');
    IF v_code !~ '^[a-z][a-z_]{0,30}$' THEN RETURN 'bad_code:' || v_code; END IF;
    IF v_code = ANY(codes) THEN RETURN 'duplicate_code:' || v_code; END IF;
    codes := codes || v_code;
    IF length(btrim(coalesce(r->>'label', ''))) = 0 OR length(r->>'label') > 60 THEN RETURN 'label_1_to_60_chars:' || v_code; END IF;
    IF coalesce(r->>'action', 'none') NOT IN ('offer', 'message', 'none') THEN RETURN 'bad_action:' || v_code; END IF;
    v_on := r->'enabled' IS DISTINCT FROM 'false'::jsonb;
    IF v_on THEN
      any_on := true;
      IF r->>'action' = 'offer' THEN
        IF nullif(r->>'coupon_id', '') IS NULL THEN RETURN 'offer_needs_coupon:' || v_code; END IF;
        IF NOT EXISTS (SELECT 1 FROM tenant_coupons c WHERE c.id::text = r->>'coupon_id' AND c.tenant_id = p_tenant_id) THEN
          RETURN 'unknown_coupon:' || v_code;
        END IF;
      END IF;
      IF r->>'action' = 'message' AND (length(btrim(coalesce(r->>'message', ''))) = 0 OR length(r->>'message') > 200) THEN
        RETURN 'message_1_to_200_chars:' || v_code;
      END IF;
    END IF;
  END LOOP;
  IF NOT any_on THEN RETURN 'at_least_one_reason'; END IF;
  RETURN NULL;
END;
$$;

-- tenant_exit_survey_save — the editor's save. Admins of the tenant only (42501 otherwise); an invalid survey is
-- refused with 22023 "invalid_exit_survey: <code>". Reasons are stored normalised to the keys the SDKs and the
-- winback function read, so nothing else rides along in the config every app downloads.
CREATE OR REPLACE FUNCTION public.tenant_exit_survey_save(
  p_tenant_id   UUID,
  p_enabled     BOOLEAN,
  p_title       TEXT,
  p_reasons     JSONB,
  p_cap_days    INT,
  p_offer_hours INT
) RETURNS public.tenant_exit_survey
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_problem TEXT;
  v_reasons JSONB;
  v_row     tenant_exit_survey;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  v_problem := exit_survey_problem(p_tenant_id, p_title, p_reasons, p_cap_days, p_offer_hours);
  IF v_problem IS NOT NULL THEN
    RAISE EXCEPTION 'invalid_exit_survey: %', v_problem USING ERRCODE = '22023';
  END IF;
  SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'code', r->>'code',
           'label', btrim(r->>'label'),
           'enabled', r->'enabled' IS DISTINCT FROM 'false'::jsonb,
           'action', coalesce(r->>'action', 'none'),
           'message', CASE WHEN r->>'action' = 'message' THEN btrim(r->>'message') END,
           'coupon_id', CASE WHEN r->>'action' = 'offer' THEN nullif(r->>'coupon_id', '') END,
           'free_text', CASE WHEN r->'free_text' = 'true'::jsonb THEN true END)) ORDER BY ord)
    INTO v_reasons
    FROM jsonb_array_elements(p_reasons) WITH ORDINALITY AS x(r, ord);
  INSERT INTO tenant_exit_survey (tenant_id, enabled, title, reasons, survey_cap_days, offer_hours, updated_at)
  VALUES (p_tenant_id, coalesce(p_enabled, true), btrim(p_title), v_reasons, p_cap_days, p_offer_hours, now())
  ON CONFLICT (tenant_id) DO UPDATE SET
    enabled = EXCLUDED.enabled,
    title = EXCLUDED.title,
    reasons = EXCLUDED.reasons,
    survey_cap_days = EXCLUDED.survey_cap_days,
    offer_hours = EXCLUDED.offer_hours,
    updated_at = now()
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.tenant_exit_survey_save(UUID, BOOLEAN, TEXT, JSONB, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.tenant_exit_survey_save(UUID, BOOLEAN, TEXT, JSONB, INT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.exit_survey_problem(UUID, TEXT, JSONB, INT, INT) TO authenticated, service_role;
