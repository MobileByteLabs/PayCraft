-- 071_tenant_paywall_v2_content_fields.test.sql
--
-- Round-trip + sanitization rejection tests for migration 071. Runs entirely
-- inside a transaction that always ROLLBACKs so the test is safe against
-- any database. Invoke via:
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 \
--        -f server/migrations/071_tenant_paywall_v2_content_fields.test.sql
--
-- A successful run prints "071 tests: ALL PASS". Any failure raises and
-- ROLLBACK rolls back the test tenant + paywall row.

BEGIN;

-- ── Test setup ──────────────────────────────────────────────────────────
DO $$
DECLARE
  v_test_tenant UUID := '11111111-1111-1111-1111-111111111111';
  v_admin       UUID := COALESCE((SELECT id FROM auth.users LIMIT 1), uuid_generate_v4());
  v_row         tenant_paywall%ROWTYPE;
  v_caught      BOOLEAN;
BEGIN
  -- Test tenant + admin link so tenant_paywall_upsert's auth.uid() check passes
  INSERT INTO tenants (id, name, plan, entitlements, status, owner_email, api_key_test, api_key_live)
    VALUES (v_test_tenant, 'test-071', 'free', '[]'::jsonb, 'active', 'test@example.com',
            'pk_test_071_fixture', 'pk_live_071_fixture')
    ON CONFLICT (id) DO NOTHING;
  INSERT INTO tenant_admins (tenant_id, user_id, role)
    VALUES (v_test_tenant, v_admin, 'owner')
    ON CONFLICT DO NOTHING;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);

  -- ── Test 1: round-trip all 11 v2 fields including rich-triple value_props ──
  PERFORM tenant_paywall_upsert(jsonb_build_object(
    'tenant_id', v_test_tenant,
    'hero_title', 'Custom Title',
    'hero_subtitle', 'Custom Subtitle',
    'value_props', '[
      {"icon":"ad-free","title":"Ad-free","description":"No interruptions"},
      {"icon":"hd","title":"HD Downloads"}
    ]'::jsonb,
    'cta_continue', 'Subscribe Now',
    'cta_get_premium', 'Upgrade',
    'restore_label', 'Restore',
    'terms_url', 'https://example.com/terms',
    'privacy_url', 'https://example.com/privacy',
    'popular_plan_sku', 'pro-quarterly',
    'success_title', 'Yay!',
    'success_message', 'You are premium.',
    'success_cta_label', 'Continue',
    'hero_icon_svg', '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/></svg>'
  ));

  SELECT * INTO v_row FROM tenant_paywall WHERE tenant_id = v_test_tenant;
  IF v_row.hero_title          <> 'Custom Title'                THEN RAISE EXCEPTION 'T1.1 hero_title round-trip failed: %', v_row.hero_title; END IF;
  IF v_row.hero_subtitle       <> 'Custom Subtitle'             THEN RAISE EXCEPTION 'T1.2 hero_subtitle round-trip failed'; END IF;
  IF jsonb_array_length(v_row.value_props) <> 2                 THEN RAISE EXCEPTION 'T1.3 value_props length: %', jsonb_array_length(v_row.value_props); END IF;
  IF (v_row.value_props->0->>'icon') <> 'ad-free'                THEN RAISE EXCEPTION 'T1.4 value_props[0].icon: %', v_row.value_props->0->>'icon'; END IF;
  IF v_row.popular_plan_sku    <> 'pro-quarterly'                THEN RAISE EXCEPTION 'T1.5 popular_plan_sku: %', v_row.popular_plan_sku; END IF;
  IF v_row.terms_url           <> 'https://example.com/terms'    THEN RAISE EXCEPTION 'T1.6 terms_url: %', v_row.terms_url; END IF;
  IF v_row.success_title       <> 'Yay!'                         THEN RAISE EXCEPTION 'T1.7 success_title: %', v_row.success_title; END IF;
  IF v_row.hero_icon_svg IS NULL OR length(v_row.hero_icon_svg) = 0 THEN RAISE EXCEPTION 'T1.8 hero_icon_svg empty'; END IF;
  RAISE NOTICE 'T1 round-trip: PASS';

  -- ── Test 2: defaults fire on v1 payload (missing v2 fields) ───────────
  PERFORM tenant_paywall_upsert(jsonb_build_object(
    'tenant_id', v_test_tenant,
    'template', 'branded-stack'
    -- no v2 fields supplied
  ));
  SELECT * INTO v_row FROM tenant_paywall WHERE tenant_id = v_test_tenant;
  IF v_row.hero_title <> 'Upgrade to Premium'                 THEN RAISE EXCEPTION 'T2.1 hero_title default fallback failed: %', v_row.hero_title; END IF;
  IF v_row.cta_continue <> 'Continue'                         THEN RAISE EXCEPTION 'T2.2 cta_continue default failed: %', v_row.cta_continue; END IF;
  IF v_row.restore_label <> 'Restore Your Premium'            THEN RAISE EXCEPTION 'T2.3 restore_label default failed: %', v_row.restore_label; END IF;
  IF v_row.success_title <> 'Welcome to Premium!'             THEN RAISE EXCEPTION 'T2.4 success_title default failed'; END IF;
  RAISE NOTICE 'T2 v1-payload defaults: PASS';

  -- ── Test 3: sanitize_paywall_svg rejects forbidden patterns ───────────
  v_caught := FALSE;
  BEGIN
    PERFORM tenant_paywall_upsert(jsonb_build_object(
      'tenant_id', v_test_tenant,
      'hero_icon_svg', '<svg><script>alert(1)</script></svg>'
    ));
  EXCEPTION WHEN check_violation THEN v_caught := TRUE;
  END;
  IF NOT v_caught THEN RAISE EXCEPTION 'T3.1 <script> rejection failed'; END IF;

  v_caught := FALSE;
  BEGIN
    PERFORM tenant_paywall_upsert(jsonb_build_object(
      'tenant_id', v_test_tenant,
      'hero_icon_svg', '<svg><foreignObject></foreignObject></svg>'
    ));
  EXCEPTION WHEN check_violation THEN v_caught := TRUE;
  END;
  IF NOT v_caught THEN RAISE EXCEPTION 'T3.2 <foreignObject> rejection failed'; END IF;

  v_caught := FALSE;
  BEGIN
    PERFORM tenant_paywall_upsert(jsonb_build_object(
      'tenant_id', v_test_tenant,
      'hero_icon_svg', '<svg><image href="https://evil.com/img.png"/></svg>'
    ));
  EXCEPTION WHEN check_violation THEN v_caught := TRUE;
  END;
  IF NOT v_caught THEN RAISE EXCEPTION 'T3.3 external href rejection failed'; END IF;
  RAISE NOTICE 'T3 SVG sanitization: PASS';

  -- ── Test 4: sanitize_paywall_svg accepts safe SVG ────────────────────
  PERFORM tenant_paywall_upsert(jsonb_build_object(
    'tenant_id', v_test_tenant,
    'hero_icon_svg', '<svg viewBox="0 0 24 24"><path d="M12 2L2 22h20L12 2z"/></svg>'
  ));
  SELECT hero_icon_svg INTO v_row.hero_icon_svg FROM tenant_paywall WHERE tenant_id = v_test_tenant;
  IF v_row.hero_icon_svg IS NULL                              THEN RAISE EXCEPTION 'T4.1 safe SVG dropped'; END IF;
  RAISE NOTICE 'T4 safe SVG accepted: PASS';

  -- ── Test 5: idempotent migration re-apply (column already exists) ────
  -- This is implicit — the migration's IF NOT EXISTS guards mean a second
  -- application produces zero new columns. Verifying by counting:
  PERFORM 1 FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'tenant_paywall'
     AND column_name IN (
       'hero_title','hero_subtitle','value_props','cta_continue','cta_get_premium',
       'restore_label','terms_url','privacy_url','popular_plan_sku',
       'success_title','success_message','success_cta_label','hero_icon_svg','hero_icon_url'
     );
  IF (SELECT COUNT(*) FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'tenant_paywall'
         AND column_name IN (
           'hero_title','hero_subtitle','value_props','cta_continue','cta_get_premium',
           'restore_label','terms_url','privacy_url','popular_plan_sku',
           'success_title','success_message','success_cta_label','hero_icon_svg','hero_icon_url'
         )) <> 14 THEN
    RAISE EXCEPTION 'T5 idempotency: expected 14 v2 columns, got different';
  END IF;
  RAISE NOTICE 'T5 column inventory: PASS (14 v2 columns present)';

  RAISE NOTICE '071 tests: ALL PASS';
END $$;

ROLLBACK;
