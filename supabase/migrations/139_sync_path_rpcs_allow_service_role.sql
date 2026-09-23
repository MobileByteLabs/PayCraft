-- 139_sync_path_rpcs_allow_service_role.sql
--
-- Widen the REMAINING admin-gated RPCs on the product-sync path to the service role.
--
-- WHY THIS IS ONE MIGRATION AND NOT TWELVE
-- 138 widened two status RPCs after each was caught by a failed sync. That is whack-a-mole: the
-- machine path traverses a whole chain of `auth.uid() IN tenant_admins` functions, and fixing the
-- one the last run happened to hit just moves the failure one step deeper. Enumerating every RPC
-- the sync path calls found TWELVE more, including `tenant_providers_merge_payment_links` — the
-- function that actually WRITES the payment links. The machine path could never have completed.
--
-- HOW THE FAILURES PRESENTED (all silent, all misleading)
--   • "Stripe is not connected"  — it is connected; `tenant_stripe_provider_status` raised forbidden
--   • "razorpay sync failed for every configured mode" — the modes were right; the writes were refused
--   • `synced: 3` in the response while every per-provider verdict was `skipped`
-- Each caller destructures `{ data }` and drops `error`, so a refusal reads as an empty result.
--
-- WHAT THIS CHANGES, STATED PLAINLY
-- service_role may now call these, including three that DECRYPT provider credentials
-- (`tenant_providers_decrypt_key`, `tenant_providers_decrypt_store_key`,
-- `tenant_stripe_connect_decrypt`). That is not a new capability in substance: service_role already
-- bypasses RLS and can read `provider_accounts.credential_enc` plus the decrypt key directly, and
-- `tenant_psp_credential_resolve` has been service_role-granted since 112 precisely so the edge
-- functions can resolve credentials. This makes the dashboard path consistent with that, rather
-- than adding a door.
--
-- The `authenticated` branch is untouched everywhere: a logged-in non-admin is still refused.

-- CLASSIFICATION — every function on the list is accounted for, none silently skipped:
--   widened here                     : the admin guard now has a service_role branch
--   already permissive               : `sync_event_emit` guards with `auth.uid() IS NOT NULL AND
--                                      NOT EXISTS(...)`, which a null-uid service_role caller
--                                      already passes
--   no guard to widen                : `tenant_stripe_connect_decrypt(uuid, text)` — the internal
--                                      overload that takes the key explicitly and never gated

-- ── tenant_pricing_ensure_served_locales ──
CREATE OR REPLACE FUNCTION public.tenant_pricing_ensure_served_locales(p_tenant_id uuid, p_default_currency text DEFAULT 'USD'::text)
 RETURNS TABLE(product_sku text, locale text, currency text, amount_cents integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (SELECT 1 FROM tenant_admins WHERE tenant_id=p_tenant_id AND user_id=auth.uid())
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

-- ── tenant_products_set_razorpay_ids ──
CREATE OR REPLACE FUNCTION public.tenant_products_set_razorpay_ids(p_id uuid, p_razorpay_plan_id_by_currency jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_tenant FROM tenant_products WHERE id = p_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'product not found'; END IF;
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = v_tenant AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  UPDATE tenant_products
    SET razorpay_plan_id_by_currency = p_razorpay_plan_id_by_currency
    WHERE id = p_id;
END;
$function$;

-- ── tenant_products_set_store_ids ──
CREATE OR REPLACE FUNCTION public.tenant_products_set_store_ids(p_id uuid, p_play_product_id text, p_app_store_product_id text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_tenant FROM tenant_products WHERE id = p_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'product not found'; END IF;
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = v_tenant AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  UPDATE tenant_products SET
    play_product_id      = COALESCE(p_play_product_id, play_product_id),
    app_store_product_id = COALESCE(p_app_store_product_id, app_store_product_id),
    updated_at           = now()
  WHERE id = p_id;
END;
$function$;

-- ── tenant_products_set_stripe_ids ──
CREATE OR REPLACE FUNCTION public.tenant_products_set_stripe_ids(p_id uuid, p_stripe_product_id text, p_stripe_price_id_by_currency jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_tenant FROM tenant_products WHERE id = p_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'product not found'; END IF;
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = v_tenant AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  UPDATE tenant_products SET
    stripe_product_id = p_stripe_product_id,
    stripe_price_id_by_currency = p_stripe_price_id_by_currency
  WHERE id = p_id;
END;
$function$;

-- ── tenant_products_set_sync_state ──
CREATE OR REPLACE FUNCTION public.tenant_products_set_sync_state(p_id uuid, p_status text, p_state jsonb DEFAULT NULL::jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant UUID;
BEGIN
  SELECT tenant_id INTO v_tenant FROM tenant_products WHERE id = p_id;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'product not found' USING ERRCODE = 'no_data_found';
  END IF;
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = v_tenant AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_status NOT IN ('pending','syncing','synced','partial','failed') THEN
    RAISE EXCEPTION 'invalid sync_status: %', p_status USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE tenant_products
     SET sync_status = p_status,
         -- Merge the provided per-provider detail over the existing map so a
         -- single-provider retry doesn't wipe the others' recorded state.
         sync_state  = CASE WHEN p_state IS NULL THEN sync_state ELSE sync_state || p_state END,
         synced_at   = CASE WHEN p_status = 'synced' THEN now() ELSE synced_at END
   WHERE id = p_id;
END;
$function$;

-- ── tenant_providers_decrypt_key ──
CREATE OR REPLACE FUNCTION public.tenant_providers_decrypt_key(p_tenant_id uuid, p_provider text, p_mode text)
 RETURNS TABLE(secret_key text, key_id text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  RETURN QUERY
  SELECT r.secret_key, r.key_id
  FROM tenant_psp_credential_resolve(p_tenant_id, p_provider, p_mode) r;
END;
$function$;

-- ── tenant_providers_decrypt_store_key ──
CREATE OR REPLACE FUNCTION public.tenant_providers_decrypt_store_key(p_tenant_id uuid, p_provider text)
 RETURNS TABLE(credential text, config jsonb)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_tp        RECORD;
  v_acct      RECORD;
  v_owner     UUID;
  v_cred_enc  BYTEA;
  v_acct_cfg  JSONB := '{}'::jsonb;
  v_use_acct  BOOLEAN := true;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  SELECT * INTO v_tp FROM tenant_providers
  WHERE tenant_id = p_tenant_id AND provider = p_provider;

  IF v_tp.provider_account_id IS NOT NULL THEN
    -- 1. Pinned.
    SELECT * INTO v_acct FROM provider_accounts WHERE id = v_tp.provider_account_id;
  ELSIF v_tp.store_credential_enc IS NOT NULL THEN
    -- 2. Its own credential — do not look at the default at all.
    v_use_acct := false;
    SELECT * INTO v_acct FROM provider_accounts WHERE false;
  ELSE
    -- 3. Inherit.
    SELECT u.id INTO v_owner
    FROM tenants t JOIN auth.users u ON lower(u.email) = lower(t.owner_email)
    WHERE t.id = p_tenant_id LIMIT 1;
    IF v_owner IS NULL THEN
      SELECT user_id INTO v_owner FROM tenant_admins
      WHERE tenant_id = p_tenant_id ORDER BY created_at LIMIT 1;
    END IF;

    SELECT a.* INTO v_acct
    FROM provider_accounts a
    WHERE a.provider = p_provider AND a.is_default
      AND a.owner_user_id IN (SELECT user_id FROM tenant_admins WHERE tenant_id = p_tenant_id)
    ORDER BY (a.owner_user_id = v_owner) DESC, a.created_at
    LIMIT 1;
  END IF;

  IF v_use_acct AND v_acct.id IS NOT NULL AND v_acct.credential_enc IS NOT NULL THEN
    v_cred_enc := v_acct.credential_enc;
    v_acct_cfg := COALESCE(v_acct.config, '{}'::jsonb);
  ELSE
    v_cred_enc := v_tp.store_credential_enc;
  END IF;

  RETURN QUERY
  SELECT
    CASE WHEN v_cred_enc IS NULL THEN NULL
         ELSE decrypt_provider_key(v_cred_enc)::TEXT END,
    v_acct_cfg || COALESCE(v_tp.store_config, '{}'::jsonb);
END;
$function$;

-- ── tenant_providers_merge_payment_links ──
CREATE OR REPLACE FUNCTION public.tenant_providers_merge_payment_links(p_tenant_id uuid, p_provider text, p_mode text, p_sku text, p_payment_links jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_column TEXT;
  v_current JSONB;
  v_updated JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF p_sku IS NULL OR length(trim(p_sku)) = 0 THEN
    RAISE EXCEPTION 'p_sku required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF p_mode NOT IN ('test', 'live') THEN
    RAISE EXCEPTION 'p_mode must be test or live' USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Ensure row exists.
  INSERT INTO tenant_providers (tenant_id, provider, test_payment_links, live_payment_links)
       VALUES (p_tenant_id, p_provider, '{}'::jsonb, '{}'::jsonb)
  ON CONFLICT (tenant_id, provider) DO NOTHING;

  v_column := CASE WHEN p_mode = 'live' THEN 'live_payment_links' ELSE 'test_payment_links' END;

  -- Read current value, splice the new (sku → links) entry on top, write back.
  -- `||` at the outer level inserts/replaces just the p_sku key; other SKUs are
  -- preserved. p_payment_links replaces the per-currency block in full (caller is
  -- the authoritative source of truth for that product's currencies).
  IF p_mode = 'live' THEN
    SELECT COALESCE(live_payment_links, '{}'::jsonb) INTO v_current
      FROM tenant_providers
     WHERE tenant_id = p_tenant_id AND provider = p_provider;
    v_updated := v_current || jsonb_build_object(p_sku, p_payment_links);
    UPDATE tenant_providers
       SET live_payment_links = v_updated, updated_at = now()
     WHERE tenant_id = p_tenant_id AND provider = p_provider;
  ELSE
    SELECT COALESCE(test_payment_links, '{}'::jsonb) INTO v_current
      FROM tenant_providers
     WHERE tenant_id = p_tenant_id AND provider = p_provider;
    v_updated := v_current || jsonb_build_object(p_sku, p_payment_links);
    UPDATE tenant_providers
       SET test_payment_links = v_updated, updated_at = now()
     WHERE tenant_id = p_tenant_id AND provider = p_provider;
  END IF;
END;
$function$;

-- ── tenant_providers_resolved_list ──
CREATE OR REPLACE FUNCTION public.tenant_providers_resolved_list(p_tenant_id uuid)
 RETURNS TABLE(provider text, connected boolean, via_default boolean, account_id uuid, label text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_provider TEXT;
  v_res      JSONB;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- The provider vocabulary comes from the registry plus whatever rows the app already has, so a
  -- provider this app configured but the registry has not yet listed is still reported rather than
  -- silently dropped.
  FOR v_provider IN
    SELECT DISTINCT p FROM (
      SELECT DISTINCT pmr.provider AS p FROM provider_method_registry pmr
      UNION
      SELECT DISTINCT tp.provider    FROM tenant_providers tp WHERE tp.tenant_id = p_tenant_id
      UNION
      -- Providers the ACCOUNT has connections for: an app that has never touched Play still has a
      -- Play connection available to it through the default, and the index must say so.
      SELECT DISTINCT pa.provider FROM provider_accounts pa
      WHERE pa.owner_user_id IN (SELECT user_id FROM tenant_admins WHERE tenant_id = p_tenant_id)
    ) x WHERE p IS NOT NULL
  LOOP
    v_res := tenant_provider_resolve(p_tenant_id, v_provider);
    provider    := v_provider;
    connected   := COALESCE((v_res->>'connected')::BOOLEAN, false);
    via_default := COALESCE((v_res->>'via_default')::BOOLEAN, false);
    account_id  := NULLIF(v_res->>'account_id','')::UUID;
    label       := v_res->>'label';
    RETURN NEXT;
  END LOOP;
END;
$function$;

-- ── tenant_stripe_connect_decrypt ──
CREATE OR REPLACE FUNCTION public.tenant_stripe_connect_decrypt(p_tenant_id uuid)
 RETURNS TABLE(access_token text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (
    SELECT 1 FROM tenant_admins
    WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT pgp_sym_decrypt(t.access_token_enc, current_setting('app.encryption_key'))::TEXT
  FROM tenant_stripe_connect t
  WHERE t.tenant_id = p_tenant_id;
END;
$function$;

-- ── tenant_stripe_provider_status ──
CREATE OR REPLACE FUNCTION public.tenant_stripe_provider_status(p_tenant_id uuid)
 RETURNS TABLE(source text, account_id text, livemode boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Prefer the OAuth row when both exist (Connect platform mode is the
  -- "official" production setup).
  IF EXISTS (
    SELECT 1 FROM tenant_stripe_connect WHERE tenant_id = p_tenant_id
  ) THEN
    RETURN QUERY
    SELECT 'oauth'::TEXT, t.stripe_account_id, t.livemode
    FROM tenant_stripe_connect t WHERE t.tenant_id = p_tenant_id;
    RETURN;
  END IF;

  -- Manual keys path — return whichever mode has both pk and sk populated.
  -- Live takes precedence over test when both are set (operator opted into
  -- production by populating the live slot).
  RETURN QUERY
  SELECT
    'manual'::TEXT,
    COALESCE(t.live_key_id, t.test_key_id) AS account_id,
    (t.live_key_id IS NOT NULL AND t.live_secret_key_enc IS NOT NULL) AS livemode
  FROM tenant_providers t
  WHERE t.tenant_id = p_tenant_id
    AND t.provider = 'stripe'
    AND COALESCE(t.test_key_id, t.live_key_id) IS NOT NULL;
END;
$function$;

