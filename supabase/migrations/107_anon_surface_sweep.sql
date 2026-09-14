-- 107_anon_surface_sweep.sql
--
-- Close the anon EXECUTE surface across EVERY SECURITY DEFINER function in `public`, and keep it
-- closed by construction rather than by remembering.
--
-- 094–097 are applied, and they did add in-body authorisation guards — but every one of them ended
-- with `REVOKE ALL ON FUNCTION … FROM anon`, which does not revoke anything. PostgreSQL grants
-- EXECUTE to PUBLIC by default on CREATE FUNCTION and `anon` inherits through PUBLIC; revoking from
-- `anon` leaves that untouched. Measured on production before this migration: **81** SECURITY
-- DEFINER functions in `public` were anon-executable. The class was never closed, only papered over
-- with body guards — and a body guard is one careless edit from being gone.
--
-- ── What stays open, and why exactly these ───────────────────────────────────────────────────
-- The PayCraft SDK ships the publishable anon key inside client apps by design, and calls seven
-- PostgREST RPCs with it. Each authorises on a CAPABILITY the caller must already hold — a
-- `p_server_token` bound to a device plus the tenant's `p_api_key` — which is the correct pattern
-- for a client-facing API and cannot be replaced by `auth.uid()` (there is no logged-in user).
-- Those seven are allowlisted BY SIGNATURE, not by name, because two of them have legacy overloads
-- that must NOT stay open (below). Everything the SDK reaches other than these seven goes through
-- an Edge Function holding the service-role key, which this migration does not touch.
--
-- ── The two overloads this closes, which are the reason signatures matter ────────────────────
-- `is_premium(user_email text)` and `get_subscription(user_email text)` are v1 leftovers: SECURITY
-- DEFINER, anon-executable, and guarded by NOTHING — no api key, no server token, no uid. Anyone
-- holding a shipped publishable key could ask "is this address a paying customer, and on what
-- plan?" for any email they cared to type. The SDK calls the `(p_server_token, p_api_key)`
-- overloads; these answer on an email alone. Name-based allowlisting would have kept them open.
--
-- Also closed here: `tenant_stripe_connect_decrypt(uuid, text)` — a second, unguarded overload
-- beside the tenant-admin-guarded one, decrypting a tenant's Stripe access token. It takes the
-- passphrase as an argument so it is not directly exploitable, but it is the same
-- unguarded-decryption-oracle shape 096 closed on `decrypt_provider_key`, with the sibling overload
-- missed. An oracle that only needs one more secret is worth removing before that secret leaks.
--
-- ── Why REVOKE PUBLIC + GRANT authenticated, service_role ────────────────────────────────────
-- Revoking PUBLIC alone would strip legitimate callers that only ever held the PUBLIC grant, which
-- is how a security fix becomes an outage. Verified empirically on the eight functions 105 already
-- revoked: `service_role` retained EXECUTE (Supabase grants it separately), but the explicit GRANT
-- is written anyway so this does not rest on that continuing to be true. Granting `authenticated`
-- is strictly a REDUCTION from the status quo — these functions were reachable by anon a moment
-- ago — and every one keeps whatever in-body guard 094–097 gave it.

DO $$
DECLARE
  r RECORD;
  -- Signature allowlist: SDK-facing, capability-token-guarded, called with the publishable key.
  keep TEXT[] := ARRAY[
    'cancel_subscription(p_provider text, p_subscription_id text, p_api_key text)',
    'get_entitlements(p_app_user_id text, p_api_key text)',
    'check_premium_with_device(p_server_token text, p_api_key text)',
    'get_subscription(p_server_token text, p_api_key text)',
    'is_premium(p_server_token text, p_api_key text)',
    'is_trial_eligible(p_server_token text, p_api_key text)',
    'register_device(p_email text, p_platform text, p_device_name text, p_device_id text, p_mode text, p_api_key text)',
    'revoke_device(p_server_token text, p_target_token text, p_api_key text)',
    'transfer_to_device(p_server_token text, p_new_device_token text, p_api_key text)'
  ];
  sig TEXT;
  n_revoked INT := 0;
BEGIN
  FOR r IN
    SELECT p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND has_function_privilege('anon', p.oid, 'execute')
  LOOP
    sig := r.proname || '(' || r.args || ')';
    CONTINUE WHEN sig = ANY(keep);

    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon', r.proname, r.args);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role', r.proname, r.args);
    n_revoked := n_revoked + 1;
  END LOOP;

  RAISE NOTICE 'anon surface sweep: % function(s) closed', n_revoked;
END;
$$;

-- ── Assert the end state, in the same transaction ────────────────────────────────────────────
-- A sweep that silently missed a function would leave exactly the hole it claims to have closed, so
-- the migration refuses to commit unless the surface is precisely the seven allowlisted signatures.
DO $$
DECLARE
  leftover TEXT;
BEGIN
  SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ')
  INTO leftover
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND has_function_privilege('anon', p.oid, 'execute')
    AND (p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')') <> ALL (ARRAY[
      'cancel_subscription(p_provider text, p_subscription_id text, p_api_key text)',
    'get_entitlements(p_app_user_id text, p_api_key text)',
    'check_premium_with_device(p_server_token text, p_api_key text)',
      'get_subscription(p_server_token text, p_api_key text)',
      'is_premium(p_server_token text, p_api_key text)',
      'is_trial_eligible(p_server_token text, p_api_key text)',
      'register_device(p_email text, p_platform text, p_device_name text, p_device_id text, p_mode text, p_api_key text)',
      'revoke_device(p_server_token text, p_target_token text, p_api_key text)',
      'transfer_to_device(p_server_token text, p_new_device_token text, p_api_key text)'
    ]);

  IF leftover IS NOT NULL THEN
    RAISE EXCEPTION 'anon surface sweep incomplete — still anon-executable: %', leftover;
  END IF;
END;
$$;
