-- 194_identity_session_device_test.sql — run inside a transaction that is rolled back.
BEGIN;
DO $$
DECLARE v_tenant UUID;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'identity_sessions' AND column_name = 'device_id') THEN
    RAISE EXCEPTION 'FAIL: identity_sessions.device_id missing';
  END IF;
  SELECT id INTO v_tenant FROM public.tenants LIMIT 1;
  INSERT INTO public.identity_sessions (id, tenant_id, provider, status, device_id)
  VALUES (repeat('t', 40), v_tenant, 'google', 'pending', 'app-dev-12345678');
  INSERT INTO public.identity_sessions (id, tenant_id, provider, status) VALUES (repeat('u', 40), v_tenant, 'google', 'pending');
  BEGIN
    INSERT INTO public.identity_sessions (id, tenant_id, provider, status, device_id)
    VALUES (repeat('y', 40), v_tenant, 'google', 'pending', 'bad id; drop');
    RAISE EXCEPTION 'FAIL: a malformed device id was stored';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS: 194 identity session device id';
END $$;
ROLLBACK;
