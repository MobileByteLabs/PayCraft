-- Assertions for migration 156 (dashboard-driven subscription-settings copy).
--
--   supabase start
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f supabase/tests/156_tenant_paywall_settings_copy_test.sql
--
-- Three things are being proved:
--
--   1. the columns default to BLANK, not English — otherwise the SDK's `ifBlank { stringResource }`
--      fallback is dead for every tenant row and the server silently overrides localisation
--   2. the SDK read emits all 14 keys — a column that exists but is missing from
--      tenant_paywall_public_get's allowlist never reaches a device, which is the designed
--      failure mode of migration 101 and the easiest thing to forget
--   3. the dashboard write round-trips them, and still refuses a non-admin

BEGIN;

CREATE TEMP TABLE _t(name TEXT, ok BOOLEAN) ON COMMIT DROP;

DO $$
DECLARE
  v_tenant  UUID;
  v_admin   UUID := gen_random_uuid();
  v_row     JSONB;
  v_public  JSONB;
  k         TEXT;
  v_missing INT := 0;
  v_keys    TEXT[] := ARRAY[
    'settings_free_label','settings_trial_label','settings_premium_label',
    'settings_free_supporting','settings_trial_supporting',
    'settings_trial_ending_today','settings_trial_one_day_left','settings_trial_days_left',
    'settings_premium_supporting','settings_renews_on','settings_expires_on',
    'settings_manage_label','settings_upgrade_label','settings_restore_label'
  ];
BEGIN
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('paywall-copy-fixture','copy@test.local','pk_'||gen_random_uuid(),'pk_'||gen_random_uuid(),
          'wh_'||gen_random_uuid(),'wh_'||gen_random_uuid())
  RETURNING id INTO v_tenant;

  -- ── 1. Blank defaults ──────────────────────────────────────────────────────────────────────────
  -- A bare row, as a tenant who has never opened the designer would have.
  INSERT INTO tenant_paywall (tenant_id) VALUES (v_tenant);

  SELECT to_jsonb(p) INTO v_row FROM tenant_paywall p WHERE p.tenant_id = v_tenant;

  FOREACH k IN ARRAY v_keys LOOP
    IF v_row->>k IS DISTINCT FROM '' THEN
      v_missing := v_missing + 1;
      RAISE NOTICE '  not blank by default: % = %', k, v_row->>k;
    END IF;
  END LOOP;
  INSERT INTO _t VALUES ('all-14-columns-default-to-blank', v_missing = 0);

  -- The point of blank, stated as its own assertion: the SDK must be able to tell "untouched" from
  -- "configured". If the column defaulted to 'Free' there would be no value that means untouched.
  INSERT INTO _t VALUES ('blank-is-distinguishable-from-configured',
    (v_row->>'settings_free_label') = '' AND (v_row->>'settings_free_label') IS NOT NULL);

  -- ── 2. The SDK read emits every key ────────────────────────────────────────────────────────────
  v_public := tenant_paywall_public_get(v_tenant);
  v_missing := 0;
  FOREACH k IN ARRAY v_keys LOOP
    IF NOT (v_public ? k) THEN
      v_missing := v_missing + 1;
      RAISE NOTICE '  absent from tenant_paywall_public_get: %', k;
    END IF;
  END LOOP;
  INSERT INTO _t VALUES ('public_get-emits-all-14-keys', v_missing = 0);

  -- Blank must be emitted as a present-but-empty key, NOT stripped. A missing key and a blank one
  -- deserialize to the same Kotlin default today, but only because the DTO defaults to "" — and the
  -- contract the SDK relies on is "the server always tells me, blank means fall back".
  INSERT INTO _t VALUES ('public_get-emits-blank-rather-than-omitting',
    (v_public ? 'settings_renews_on') AND (v_public->>'settings_renews_on') = '');

  -- Carried over, not clobbered: the 24 pre-existing keys must survive the rewrite.
  INSERT INTO _t VALUES ('public_get-still-emits-prior-keys',
    (v_public ? 'hero_title') AND (v_public ? 'trial_disclosure_body') AND (v_public ? 'workflow'));

  -- ── 3. The dashboard write ─────────────────────────────────────────────────────────────────────
  -- Non-admin first: auth.uid() is NULL with no jwt, so the admin check must refuse. Asserted
  -- BEFORE granting admin, because a check that only ever runs authorised proves nothing.
  BEGIN
    PERFORM tenant_paywall_upsert(jsonb_build_object('tenant_id', v_tenant));
    INSERT INTO _t VALUES ('upsert-refuses-non-admin', false);
  EXCEPTION WHEN insufficient_privilege THEN
    INSERT INTO _t VALUES ('upsert-refuses-non-admin', true);
  END;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_admin)::text, true);
  INSERT INTO tenant_admins (tenant_id, user_id, role) VALUES (v_tenant, v_admin, 'owner');
  INSERT INTO _t VALUES ('jwt-claim-resolves-to-admin-uid', auth.uid() = v_admin);

  PERFORM tenant_paywall_upsert(jsonb_build_object(
    'tenant_id',                   v_tenant,
    'settings_premium_label',      'Cappy Pro',
    'settings_trial_days_left',    'Essai — {days} jours',
    'settings_renews_on',          'Renouvelle le {date}',
    'settings_trial_one_day_left', 'Dernier jour'
  ));

  SELECT to_jsonb(p) INTO v_row FROM tenant_paywall p WHERE p.tenant_id = v_tenant;
  INSERT INTO _t VALUES ('upsert-persists-a-plain-label',
    (v_row->>'settings_premium_label') = 'Cappy Pro');
  INSERT INTO _t VALUES ('upsert-persists-a-token-template',
    (v_row->>'settings_trial_days_left') = 'Essai — {days} jours');
  INSERT INTO _t VALUES ('upsert-persists-the-one-day-form-separately',
    (v_row->>'settings_trial_one_day_left') = 'Dernier jour');

  -- Omitted keys fall to blank, not to NULL — the columns are NOT NULL and the SDK's contract is
  -- blank-means-fallback. A NULL here would deserialize fine but breaks `ifBlank`.
  INSERT INTO _t VALUES ('upsert-leaves-omitted-keys-blank-not-null',
    (v_row->>'settings_manage_label') = '');

  -- And the configured values reach the SDK read, which is the whole chain this migration adds.
  v_public := tenant_paywall_public_get(v_tenant);
  INSERT INTO _t VALUES ('configured-copy-reaches-the-sdk-read',
    (v_public->>'settings_premium_label') = 'Cappy Pro'
    AND (v_public->>'settings_renews_on') = 'Renouvelle le {date}');

  -- A pre-existing field must still round-trip through the rewritten upsert. The function enumerates
  -- all 38 columns by hand, so a dropped line is a silently blanked field.
  PERFORM tenant_paywall_upsert(jsonb_build_object(
    'tenant_id', v_tenant, 'hero_title', 'Go Pro', 'trial_disclosure_title', '{days} days free'
  ));
  SELECT to_jsonb(p) INTO v_row FROM tenant_paywall p WHERE p.tenant_id = v_tenant;
  INSERT INTO _t VALUES ('upsert-still-round-trips-prior-fields',
    (v_row->>'hero_title') = 'Go Pro' AND (v_row->>'trial_disclosure_title') = '{days} days free');
END $$;

DO $$
DECLARE failed INT; r RECORD;
BEGIN
  SELECT count(*) INTO failed FROM _t WHERE NOT ok OR ok IS NULL;
  FOR r IN SELECT * FROM _t ORDER BY name LOOP
    RAISE NOTICE '% %', CASE WHEN r.ok THEN 'PASS' ELSE 'FAIL' END, r.name;
  END LOOP;
  IF failed > 0 THEN
    RAISE EXCEPTION '156 settings-copy assertions: % failed', failed;
  END IF;
  RAISE NOTICE 'ALL % assertions passed', (SELECT count(*) FROM _t);
END $$;

ROLLBACK;
