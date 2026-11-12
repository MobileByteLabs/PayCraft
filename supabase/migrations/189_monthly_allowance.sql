-- 189 — a monthly free allowance for a metered action (first consumer: Kreatwiz "full edit").
--
-- WHAT IT IS
-- A tenant gives every user N free uses of a metered action per calendar month (UTC). Past that, the
-- use is paid from a credit pack (an existing consumable balance), and Pro users are never metered.
-- One call decides which, atomically, and records it: allowance_spend → 'pro' | 'allowance' | 'credit'
-- | 'refused'. A failed use is given back with allowance_refund.
--
-- WHY A SPEND LOG AND NOT A COUNTER
-- Same reason as the balance ledger (157): "used this month" is COUNT(spends this month not
-- refunded). A counter would need its own refund and month-rollover logic and could drift; the log is
-- the audit trail support reads, and a month rolls over by itself because `period` is in the key.
--
-- WHO MAY CALL WHAT
--   allowance_spend / allowance_status — anon, with the user's own device token (the same trust as
--     entitlement_balance_spend after 162). A client spending its own allowance only hurts itself.
--   allowance_refund — service_role only. A refund means "our server failed", which a client must
--     never be able to claim; the consumer's server reaches it through PayCraft's /v1/allowance/refund
--     with a pcsk_ key holding the new `allowance:refund` scope.
--   allowance_configure — service_role (the /v1/allowance route, scope products:write).
--
-- Idempotent throughout.

-- ── 1. configuration ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.entitlement_monthly_allowance (
    tenant_id      UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    sku            TEXT NOT NULL,
    free_per_month INT  NOT NULL CHECK (free_per_month >= 0),
    -- Consumable balances that pay for a use once the allowance is gone, tried in order.
    credit_skus    TEXT[] NOT NULL DEFAULT '{}',
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, sku)
);
COMMENT ON TABLE public.entitlement_monthly_allowance IS
  'Free uses per calendar month (UTC) of a metered action, per tenant and sku, plus the credit-pack '
  'balances that pay once they run out. Read by allowance_spend.';

-- ── 2. spend log ─────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.entitlement_allowance_spends (
    tenant_id       UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    idempotency_key TEXT NOT NULL,
    subject_id      UUID NOT NULL REFERENCES public.entitlement_subjects(id) ON DELETE CASCADE,
    sku             TEXT NOT NULL,
    period          DATE NOT NULL,           -- first day of the month (UTC) the use counts against
    source          TEXT NOT NULL CHECK (source IN ('pro', 'allowance', 'credit')),
    credit_sku      TEXT,                    -- which balance paid, when source = 'credit'
    refunded_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (tenant_id, idempotency_key),
    CHECK ((source = 'credit') = (credit_sku IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS entitlement_allowance_spends_month_idx
  ON public.entitlement_allowance_spends (tenant_id, subject_id, sku, period) WHERE refunded_at IS NULL;
ALTER TABLE public.entitlement_monthly_allowance ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.entitlement_allowance_spends ENABLE ROW LEVEL SECURITY;

-- ── 3. helpers ───────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._allowance_period() RETURNS DATE
LANGUAGE sql STABLE AS $$ SELECT (date_trunc('month', now() AT TIME ZONE 'UTC'))::date $$;

-- (tenant, subject, is_pro) for a device token, with the same identity rules as the balance RPCs.
CREATE OR REPLACE FUNCTION public._allowance_caller(p_server_token TEXT, p_api_key TEXT)
RETURNS TABLE (tenant_id UUID, subject_id UUID, is_pro BOOLEAN)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant  UUID;
  v_subject UUID;
BEGIN
  v_tenant := resolve_tenant(p_api_key);
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'unknown or inactive api key' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  v_subject := entitlement_subject_of_verified_token(p_server_token, v_tenant);
  IF v_subject IS NULL THEN
    RAISE EXCEPTION 'unknown or inactive device token' USING ERRCODE = 'invalid_authorization_specification';
  END IF;
  RETURN QUERY SELECT v_tenant, v_subject,
    COALESCE((check_premium_with_device(p_server_token, p_api_key)->>'is_premium')::BOOLEAN, false);
END $$;

-- ── 4. spend ─────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.allowance_spend(
    p_server_token    TEXT,
    p_api_key         TEXT,
    p_sku             TEXT,
    p_idempotency_key TEXT
)
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c        RECORD;
  cfg      RECORD;
  v_key    TEXT := btrim(coalesce(p_idempotency_key, ''));
  v_prev   TEXT;
  v_period DATE := _allowance_period();
  v_used   INT;
  v_credit TEXT;
BEGIN
  IF v_key = '' THEN
    RAISE EXCEPTION 'idempotency_key is required' USING ERRCODE = 'null_value_not_allowed';
  END IF;
  SELECT * INTO c FROM _allowance_caller(p_server_token, p_api_key);

  -- Replay first: a retried call gets the original answer, never a second charge.
  SELECT source INTO v_prev FROM entitlement_allowance_spends WHERE tenant_id = c.tenant_id AND idempotency_key = v_key;
  IF FOUND THEN
    RETURN v_prev;
  END IF;

  SELECT * INTO cfg FROM entitlement_monthly_allowance WHERE tenant_id = c.tenant_id AND sku = p_sku;
  IF NOT FOUND THEN
    RETURN 'refused';
  END IF;

  IF c.is_pro THEN
    INSERT INTO entitlement_allowance_spends (tenant_id, idempotency_key, subject_id, sku, period, source)
    VALUES (c.tenant_id, v_key, c.subject_id, p_sku, v_period, 'pro');
    RETURN 'pro';
  END IF;

  -- Serialise this user's spends of this sku so two parallel calls cannot both take the last free use.
  PERFORM pg_advisory_xact_lock(hashtext('allowance:' || c.tenant_id || ':' || c.subject_id || ':' || p_sku));

  SELECT count(*) INTO v_used FROM entitlement_allowance_spends
   WHERE tenant_id = c.tenant_id AND subject_id = c.subject_id AND sku = p_sku
     AND period = v_period AND source = 'allowance' AND refunded_at IS NULL;
  IF v_used < cfg.free_per_month THEN
    INSERT INTO entitlement_allowance_spends (tenant_id, idempotency_key, subject_id, sku, period, source)
    VALUES (c.tenant_id, v_key, c.subject_id, p_sku, v_period, 'allowance');
    RETURN 'allowance';
  END IF;

  FOREACH v_credit IN ARRAY cfg.credit_skus LOOP
    IF entitlement_balance_of_tenant(c.tenant_id, c.subject_id, v_credit) >= 1 THEN
      PERFORM entitlement_balance_spend(p_api_key, c.subject_id, v_credit, 1, 'allowance:' || v_key);
      INSERT INTO entitlement_allowance_spends (tenant_id, idempotency_key, subject_id, sku, period, source, credit_sku)
      VALUES (c.tenant_id, v_key, c.subject_id, p_sku, v_period, 'credit', v_credit);
      RETURN 'credit';
    END IF;
  END LOOP;

  RETURN 'refused';
END $$;

-- ── 5. status ────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.allowance_status(p_server_token TEXT, p_api_key TEXT, p_sku TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c       RECORD;
  cfg     RECORD;
  v_used  INT := 0;
  v_cred  INT := 0;
  v_sku   TEXT;
  v_free  INT := 0;
BEGIN
  SELECT * INTO c FROM _allowance_caller(p_server_token, p_api_key);
  SELECT * INTO cfg FROM entitlement_monthly_allowance WHERE tenant_id = c.tenant_id AND sku = p_sku;
  IF FOUND THEN
    v_free := cfg.free_per_month;
    SELECT count(*) INTO v_used FROM entitlement_allowance_spends
     WHERE tenant_id = c.tenant_id AND subject_id = c.subject_id AND sku = p_sku
       AND period = _allowance_period() AND source = 'allowance' AND refunded_at IS NULL;
    FOREACH v_sku IN ARRAY cfg.credit_skus LOOP
      v_cred := v_cred + GREATEST(entitlement_balance_of_tenant(c.tenant_id, c.subject_id, v_sku), 0);
    END LOOP;
  END IF;
  RETURN jsonb_build_object(
    'sku', p_sku,
    'is_pro', c.is_pro,
    'free_per_month', v_free,
    'used', v_used,
    'remaining', GREATEST(v_free - v_used, 0),
    'credits', v_cred,
    'resets_at', (_allowance_period() + interval '1 month')::timestamp AT TIME ZONE 'UTC'
  );
END $$;

-- ── 6. refund (server only) ──────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.allowance_refund(p_tenant_id UUID, p_idempotency_key TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  s RECORD;
BEGIN
  UPDATE entitlement_allowance_spends SET refunded_at = now()
   WHERE tenant_id = p_tenant_id AND idempotency_key = btrim(p_idempotency_key) AND refunded_at IS NULL
  RETURNING * INTO s;
  IF NOT FOUND THEN
    RETURN false;   -- unknown, or already refunded: refunding twice must not mint an edit
  END IF;
  IF s.source = 'credit' THEN
    INSERT INTO entitlement_balance_ledger (tenant_id, subject_id, sku, delta, reason, idempotency_key)
    VALUES (s.tenant_id, s.subject_id, s.credit_sku, 1, 'adjustment', 'allowance-refund:' || s.idempotency_key)
    ON CONFLICT (tenant_id, idempotency_key) DO NOTHING;
  END IF;
  RETURN true;
END $$;

-- ── 7. configure (server only) ───────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.allowance_configure(p_tenant_id UUID, p_sku TEXT, p_free_per_month INT, p_credit_skus TEXT[])
RETURNS VOID
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO entitlement_monthly_allowance (tenant_id, sku, free_per_month, credit_skus)
  VALUES (p_tenant_id, p_sku, p_free_per_month, coalesce(p_credit_skus, '{}'))
  ON CONFLICT (tenant_id, sku) DO UPDATE
    SET free_per_month = EXCLUDED.free_per_month, credit_skus = EXCLUDED.credit_skus, updated_at = now();
$$;

REVOKE EXECUTE ON FUNCTION public._allowance_caller(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.allowance_spend(TEXT, TEXT, TEXT, TEXT) TO anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.allowance_status(TEXT, TEXT, TEXT)      TO anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.allowance_refund(UUID, TEXT)            FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.allowance_refund(UUID, TEXT)            TO service_role;
REVOKE EXECUTE ON FUNCTION public.allowance_configure(UUID, TEXT, INT, TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.allowance_configure(UUID, TEXT, INT, TEXT[]) TO service_role;

-- ── 8. the API scope that may call refund ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_api_keys_scopes_known') THEN
    ALTER TABLE tenant_api_keys DROP CONSTRAINT tenant_api_keys_scopes_known;
  END IF;
  ALTER TABLE tenant_api_keys ADD CONSTRAINT tenant_api_keys_scopes_known CHECK (
    scopes <@ ARRAY[
      'providers:read', 'products:read', 'products:sync', 'readiness:read', 'tenant:read',
      'subscribers:read', 'coupons:read', 'paywall:read', 'audit:read', 'webhooks:read',
      'products:write', 'paywall:write', 'providers:write', 'apps:read', 'apps:provision',
      'keys:rotate', 'apps:write', 'onboarding:read', 'onboarding:write',
      -- added by 189
      'allowance:refund'
    ]::TEXT[]
  );
END $$;
