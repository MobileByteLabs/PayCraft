-- Assertions for migration 178 (per-tenant active-device limit: one subscription, up to N devices).
--   PGPASSWORD=postgres psql -h 127.0.0.1 -p 54322 -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f supabase/tests/178_device_limit_test.sql
BEGIN;
DO $$
DECLARE
  v_key TEXT; v_one TEXT; tok_a TEXT; tok_b TEXT; tok_c TEXT; tok_x TEXT; r JSONB; ref_a TEXT; ref_x TEXT; n INT;
BEGIN
  -- ── a tenant that allows 2 devices ─────────────────────────────────────────────────────────────
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live, max_active_devices)
  VALUES ('device-limit-178','t178@test.local','pk_'||gen_random_uuid(),'pk_'||gen_random_uuid(),
          'wh_'||gen_random_uuid(),'wh_'||gen_random_uuid(), 2) RETURNING api_key_test INTO v_key;

  r := register_device('buyer@test.local', 'android', 'Pixel 7', 'dev-a', 'test', v_key);
  tok_a := r->>'server_token';
  IF (r->>'conflict')::boolean THEN RAISE EXCEPTION 'FAIL 1st device conflicts: %', r; END IF;

  r := register_device('buyer@test.local', 'web', 'Chrome on Mac', 'dev-b', 'test', v_key);
  tok_b := r->>'server_token';
  IF (r->>'conflict')::boolean THEN RAISE EXCEPTION 'FAIL 2nd device conflicts under a limit of 2: %', r; END IF;
  IF (check_premium_with_device(tok_b, v_key)->>'token_valid')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL 2nd device is not active';
  END IF;

  -- the same device signing in again gets its own token back, never a conflict
  r := register_device('buyer@test.local', 'android', 'Pixel 7', 'dev-a', 'test', v_key);
  IF r->>'server_token' IS DISTINCT FROM tok_a OR (r->>'conflict')::boolean THEN
    RAISE EXCEPTION 'FAIL re-register of an active device: %', r;
  END IF;

  -- ── a 3rd device: conflict, registered inactive, told which devices hold the 2 seats ───────────
  r := register_device('buyer@test.local', 'ios', 'iPhone 15', 'dev-c', 'test', v_key);
  tok_c := r->>'server_token';
  IF NOT (r->>'conflict')::boolean THEN RAISE EXCEPTION 'FAIL 3rd device does not conflict: %', r; END IF;
  IF (r->>'max_devices')::int <> 2 THEN RAISE EXCEPTION 'FAIL max_devices: %', r; END IF;
  IF jsonb_array_length(r->'active_devices') <> 2 THEN RAISE EXCEPTION 'FAIL active_devices: %', r; END IF;
  IF (r->'active_devices') @? '$[*].device_token' THEN RAISE EXCEPTION 'FAIL active_devices leaks tokens: %', r; END IF;
  IF r->>'conflicting_device_name' IS NULL THEN RAISE EXCEPTION 'FAIL legacy conflicting_device_name missing: %', r; END IF;
  IF (check_premium_with_device(tok_c, v_key)->>'token_valid')::boolean THEN
    RAISE EXCEPTION 'FAIL a conflicting device is entitled before the buyer chooses';
  END IF;
  SELECT d->>'device_ref' INTO ref_a FROM jsonb_array_elements(r->'active_devices') d WHERE d->>'device_name' = 'Pixel 7';
  IF ref_a IS NULL THEN RAISE EXCEPTION 'FAIL no device_ref for Pixel 7: %', r; END IF;

  -- a device of ANOTHER account cannot be signed out from here
  tok_x := (register_device('other@test.local', 'android', 'Other', 'dev-x', 'test', v_key))->>'server_token';
  SELECT id::text INTO ref_x FROM registered_devices WHERE device_token = tok_x;
  r := transfer_to_device(tok_c, tok_c, v_key, ref_x);
  IF (r->>'transferred')::boolean OR r->>'reason' IS DISTINCT FROM 'replace_not_found' THEN
    RAISE EXCEPTION 'FAIL foreign device ref accepted: %', r;
  END IF;
  IF (check_premium_with_device(tok_x, v_key)->>'token_valid')::boolean IS NOT TRUE THEN
    RAISE EXCEPTION 'FAIL the other account lost its device';
  END IF;

  -- ── the buyer removes the Pixel: it is signed out, the web seat stays, the iPhone becomes active ─
  r := transfer_to_device(tok_c, tok_c, v_key, ref_a);
  IF NOT (r->>'transferred')::boolean THEN RAISE EXCEPTION 'FAIL transfer with replace: %', r; END IF;
  IF (check_premium_with_device(tok_a, v_key)->>'token_valid')::boolean THEN RAISE EXCEPTION 'FAIL removed device still active'; END IF;
  IF (check_premium_with_device(tok_b, v_key)->>'token_valid')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FAIL kept device was signed out'; END IF;
  IF (check_premium_with_device(tok_c, v_key)->>'token_valid')::boolean IS NOT TRUE THEN RAISE EXCEPTION 'FAIL new device not active'; END IF;
  SELECT count(*) INTO n FROM registered_devices WHERE lower(email) = 'buyer@test.local' AND is_active;
  IF n <> 2 THEN RAISE EXCEPTION 'FAIL active count after replace = %', n; END IF;

  -- without a choice, a full account still never goes above its limit — and the device NOT seen for the
  -- longest is the one signed out (ages set explicitly: inside one transaction now() never moves)
  UPDATE registered_devices SET last_seen_at = now() - interval '2 days' WHERE device_token = tok_b;
  UPDATE registered_devices SET last_seen_at = now() - interval '1 hour' WHERE device_token = tok_c;
  r := register_device('buyer@test.local', 'android', 'Pixel 8', 'dev-d', 'test', v_key);
  r := transfer_to_device(r->>'server_token', r->>'server_token', v_key);
  SELECT count(*) INTO n FROM registered_devices WHERE lower(email) = 'buyer@test.local' AND is_active;
  IF n > 2 THEN RAISE EXCEPTION 'FAIL transfer without a choice exceeded the limit: % active', n; END IF;
  IF (check_premium_with_device(tok_b, v_key)->>'token_valid')::boolean THEN
    RAISE EXCEPTION 'FAIL the least-recently-seen device was kept';
  END IF;

  -- get_active_devices names each seat by device_ref as well (asked by a device that is still active —
  -- the step above signed out the least-recently-seen one, the web browser)
  r := get_active_devices(tok_c, v_key);
  IF NOT (r @? '$[*].device_ref') THEN RAISE EXCEPTION 'FAIL get_active_devices has no device_ref: %', r; END IF;

  -- ── manage devices: the list a signed-in device sees, and signing one out by ref ───────────────
  IF r @? '$[*].device_token' THEN RAISE EXCEPTION 'FAIL get_active_devices leaks other devices tokens: %', r; END IF;
  IF (SELECT count(*) FROM jsonb_array_elements(r) d WHERE (d->>'this_device')::boolean) <> 1 THEN
    RAISE EXCEPTION 'FAIL exactly one row must be this_device: %', r;
  END IF;
  IF (r->0->>'max_devices')::int <> 2 THEN RAISE EXCEPTION 'FAIL rows do not carry max_devices: %', r; END IF;
  IF NOT has_function_privilege('anon', 'get_active_devices(text,text)', 'execute') THEN
    RAISE EXCEPTION 'FAIL get_active_devices is not callable with the publishable key';
  END IF;
  SELECT d->>'device_ref' INTO ref_a FROM jsonb_array_elements(r) d WHERE NOT (d->>'this_device')::boolean LIMIT 1;
  -- a foreign device cannot be signed out
  r := sign_out_device(tok_c, ref_x, v_key);
  IF (r->>'signed_out')::boolean THEN RAISE EXCEPTION 'FAIL foreign device signed out: %', r; END IF;
  -- an inactive caller cannot sign anyone out
  r := sign_out_device(tok_a, ref_a, v_key);
  IF (r->>'signed_out')::boolean THEN RAISE EXCEPTION 'FAIL a signed-out device signed out another: %', r; END IF;
  -- the owner signs out their other device: one seat frees up
  r := sign_out_device(tok_c, ref_a, v_key);
  IF NOT (r->>'signed_out')::boolean THEN RAISE EXCEPTION 'FAIL sign_out_device: %', r; END IF;
  SELECT count(*) INTO n FROM registered_devices WHERE lower(email) = 'buyer@test.local' AND is_active;
  IF n <> 1 THEN RAISE EXCEPTION 'FAIL active after sign out = %', n; END IF;
  IF jsonb_array_length(get_active_devices(tok_c, v_key)) <> 1 THEN RAISE EXCEPTION 'FAIL list after sign out'; END IF;
  -- the freed seat is taken without a conflict
  r := register_device('buyer@test.local', 'web', 'Firefox', 'dev-e', 'test', v_key);
  IF (r->>'conflict')::boolean THEN RAISE EXCEPTION 'FAIL freed seat still conflicts: %', r; END IF;

  -- ── default tenant: still ONE device (no behaviour change for other apps) ──────────────────────
  INSERT INTO tenants (name, owner_email, api_key_test, api_key_live, webhook_secret_test, webhook_secret_live)
  VALUES ('device-limit-178-default','t178d@test.local','pk_'||gen_random_uuid(),'pk_'||gen_random_uuid(),
          'wh_'||gen_random_uuid(),'wh_'||gen_random_uuid()) RETURNING api_key_test INTO v_one;
  tok_a := (register_device('solo@test.local', 'android', 'A', 'dev-1', 'test', v_one))->>'server_token';
  r := register_device('solo@test.local', 'web', 'B', 'dev-2', 'test', v_one);
  IF NOT (r->>'conflict')::boolean THEN RAISE EXCEPTION 'FAIL default limit is not 1: %', r; END IF;
  -- legacy transfer (no replace ref) moves premium here, as before
  r := transfer_to_device(r->>'server_token', r->>'server_token', v_one);
  IF NOT (r->>'transferred')::boolean THEN RAISE EXCEPTION 'FAIL legacy transfer: %', r; END IF;
  IF (check_premium_with_device(tok_a, v_one)->>'token_valid')::boolean THEN RAISE EXCEPTION 'FAIL legacy transfer kept the old device'; END IF;

  RAISE NOTICE 'ALL device-limit assertions passed';
END $$;
ROLLBACK;
