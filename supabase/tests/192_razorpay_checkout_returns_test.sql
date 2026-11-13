-- 192_razorpay_checkout_returns_test.sql — run inside a transaction that is rolled back.
-- The table exists, RLS is on, the browser roles cannot read it, and malformed rows are refused.
BEGIN;
DO $$
DECLARE v_tenant UUID; v_ok BOOLEAN;
BEGIN
  IF to_regclass('public.razorpay_checkout_returns') IS NULL THEN
    RAISE EXCEPTION 'FAIL: razorpay_checkout_returns missing';
  END IF;
  SELECT relrowsecurity INTO v_ok FROM pg_class WHERE oid = 'public.razorpay_checkout_returns'::regclass;
  IF NOT v_ok THEN RAISE EXCEPTION 'FAIL: RLS is off'; END IF;
  IF has_table_privilege('anon', 'public.razorpay_checkout_returns', 'SELECT')
     OR has_table_privilege('authenticated', 'public.razorpay_checkout_returns', 'SELECT') THEN
    RAISE EXCEPTION 'FAIL: browser roles can read return URLs';
  END IF;
  SELECT id INTO v_tenant FROM public.tenants LIMIT 1;
  INSERT INTO public.razorpay_checkout_returns (subscription_id, tenant_id, mode, key_id, success_url, cancel_url, short_url)
  VALUES ('sub_TESTROW01', v_tenant, 'test', 'rzp_test_abc', 'https://x.example/?paycraft_checkout=success',
          'https://x.example/?paycraft_checkout=cancel', 'https://rzp.io/rzp/x');
  BEGIN
    INSERT INTO public.razorpay_checkout_returns (subscription_id, tenant_id, mode, key_id, success_url, cancel_url, short_url)
    VALUES ('../admin', v_tenant, 'test', 'rzp_test_abc', 'https://x', 'https://x', 'https://x');
    RAISE EXCEPTION 'FAIL: a non-Razorpay subscription id was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  BEGIN
    INSERT INTO public.razorpay_checkout_returns (subscription_id, tenant_id, mode, key_id, success_url, cancel_url, short_url)
    VALUES ('sub_TESTROW02', v_tenant, 'test', 'rzp_test_abc', 'javascript:alert(1)', 'https://x', 'https://x');
    RAISE EXCEPTION 'FAIL: a non-http success_url was accepted';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  RAISE NOTICE 'PASS: 192 razorpay_checkout_returns';
END $$;
ROLLBACK;
