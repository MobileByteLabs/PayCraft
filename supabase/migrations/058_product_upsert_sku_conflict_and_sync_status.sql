-- Migration 058 — fix two product-flow bugs the dashboard surfaced:
--
-- A.  tenant_products_upsert hit "duplicate key value violates unique
--     constraint tenant_products_tenant_id_sku_key" when the dashboard sent a
--     fresh UUID for a SKU that already existed. The 051 redefinition only
--     declared ON CONFLICT (id), so the secondary (tenant_id, sku) unique
--     constraint kicked in. Resolution: use (tenant_id, sku) as the conflict
--     target instead — that's the natural key from the API's perspective.
--
-- B.  The dashboard's product save path checked tenant_stripe_connect_status
--     (OAuth table) to decide whether to push the product to Stripe. Manual
--     API key tenants got silently skipped → products never landed in Stripe.
--     This migration adds tenant_stripe_provider_status which returns a
--     unified view across both OAuth and Manual-keys onboarding paths. The
--     dashboard's stripeSyncProduct helper switches to this RPC in the same
--     PR — that's where the "products never sync after Manual connect" bug
--     actually got fixed.
--
-- C.  New RPC tenant_products_unsynced returns products that still lack the
--     provider-side artifacts (stripe_product_id NULL etc) so the dashboard
--     can offer a "Sync N existing products" CTA after a fresh provider
--     connect.

-- ---------------------------------------------------------------------------
-- A. Fix tenant_products_upsert ON CONFLICT target.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tenant_products_upsert(p_row JSONB)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
  v_tenant_id UUID := (p_row->>'tenant_id')::UUID;
  v_sku TEXT := p_row->>'sku';
  v_new_id UUID := COALESCE(NULLIF(p_row->>'id','')::UUID, gen_random_uuid());
BEGIN
  -- Authorization: only tenant admins may upsert.
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins
    WHERE tenant_id = v_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- Insert OR update on (tenant_id, sku) — the natural key. The dashboard
  -- may pass a fresh UUID; the existing row's id is preserved by the
  -- DO UPDATE branch via the RETURNING clause below.
  INSERT INTO tenant_products (
    id, tenant_id, sku, type, display_name,
    trial_enabled, trial_duration_days, attaches_to_product_id, interval,
    base_price_cents, base_currency, display_order, active,
    pricing_mode, global_price_cents, global_currency,
    discount_percent, discount_ends_at
  )
  VALUES (
    v_new_id,
    v_tenant_id,
    v_sku,
    (p_row->>'type')::product_type,
    p_row->>'display_name',
    COALESCE((p_row->>'trial_enabled')::BOOLEAN, true),
    NULLIF(p_row->>'trial_duration_days','')::INT,
    NULLIF(p_row->>'attaches_to_product_id','')::UUID,
    NULLIF(p_row->>'interval',''),
    COALESCE((p_row->>'base_price_cents')::INT, 0),
    COALESCE(p_row->>'base_currency', 'USD'),
    COALESCE((p_row->>'display_order')::INT, 0),
    COALESCE((p_row->>'active')::BOOLEAN, true),
    COALESCE((p_row->>'pricing_mode')::pricing_mode, 'auto'),
    NULLIF(p_row->>'global_price_cents','')::INT,
    NULLIF(p_row->>'global_currency',''),
    NULLIF(p_row->>'discount_percent','')::INT,
    NULLIF(p_row->>'discount_ends_at','')::TIMESTAMPTZ
  )
  ON CONFLICT (tenant_id, sku) DO UPDATE
    SET type                   = EXCLUDED.type,
        display_name           = EXCLUDED.display_name,
        trial_enabled          = EXCLUDED.trial_enabled,
        trial_duration_days    = EXCLUDED.trial_duration_days,
        attaches_to_product_id = EXCLUDED.attaches_to_product_id,
        interval               = EXCLUDED.interval,
        base_price_cents       = EXCLUDED.base_price_cents,
        base_currency          = EXCLUDED.base_currency,
        display_order          = EXCLUDED.display_order,
        active                 = EXCLUDED.active,
        pricing_mode           = EXCLUDED.pricing_mode,
        global_price_cents     = EXCLUDED.global_price_cents,
        global_currency        = EXCLUDED.global_currency,
        discount_percent       = EXCLUDED.discount_percent,
        discount_ends_at       = EXCLUDED.discount_ends_at,
        updated_at             = NOW()
    RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_products_upsert(JSONB) TO authenticated;

-- ---------------------------------------------------------------------------
-- B. Unified Stripe-connection status across OAuth + Manual keys paths.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tenant_stripe_provider_status(p_tenant_id UUID)
RETURNS TABLE (
  source        TEXT,        -- 'oauth' | 'manual' | null
  account_id    TEXT,        -- pk_test_… (manual) | acct_… (oauth) | null
  livemode      BOOLEAN
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
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
$$;

GRANT EXECUTE ON FUNCTION public.tenant_stripe_provider_status(uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- C. Products that have not yet been pushed to a given provider.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.tenant_products_unsynced(
  p_tenant_id UUID,
  p_provider  TEXT
)
RETURNS TABLE (
  id               UUID,
  sku              TEXT,
  display_name     TEXT,
  type             product_type,
  billing_interval TEXT,
  base_price_cents INT,
  base_currency    TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF p_provider = 'stripe' THEN
    RETURN QUERY
    SELECT p.id, p.sku, p.display_name, p.type, p.interval AS billing_interval,
           p.base_price_cents, p.base_currency
    FROM tenant_products p
    WHERE p.tenant_id = p_tenant_id
      AND p.active = TRUE
      AND p.stripe_product_id IS NULL
    ORDER BY p.display_order, p.created_at;
  ELSIF p_provider = 'razorpay' THEN
    RETURN QUERY
    SELECT p.id, p.sku, p.display_name, p.type, p.interval AS billing_interval,
           p.base_price_cents, p.base_currency
    FROM tenant_products p
    WHERE p.tenant_id = p_tenant_id
      AND p.active = TRUE
      AND (p.razorpay_plan_id_by_currency IS NULL
           OR p.razorpay_plan_id_by_currency = '{}'::jsonb)
    ORDER BY p.display_order, p.created_at;
  ELSE
    RAISE EXCEPTION 'unknown provider: %', p_provider;
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.tenant_products_unsynced(uuid, text) TO authenticated;
