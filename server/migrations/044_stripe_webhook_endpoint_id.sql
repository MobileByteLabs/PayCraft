-- Migration 044: Stripe Connect — webhook endpoint tracking + save/set/disconnect RPCs.
-- Pairs with Phase 1 of paycraft-dashboard-provider-integration epic.

-- 1. Add webhook_endpoint_id column to tenant_stripe_connect (idempotent)
ALTER TABLE public.tenant_stripe_connect
  ADD COLUMN IF NOT EXISTS webhook_endpoint_id TEXT;
COMMENT ON COLUMN public.tenant_stripe_connect.webhook_endpoint_id
  IS 'Stripe webhook endpoint ID (we_...) auto-registered during Connect; used to revoke on disconnect.';

-- 2. RPC: tenant_stripe_connect_save — encrypts tokens via pgcrypto + upserts row.
CREATE OR REPLACE FUNCTION tenant_stripe_connect_save(
  p_tenant_id UUID,
  p_stripe_account_id TEXT,
  p_access_token TEXT,
  p_refresh_token TEXT,
  p_livemode BOOLEAN,
  p_scope TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins
    WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden: not an admin of tenant %', p_tenant_id;
  END IF;

  INSERT INTO tenant_stripe_connect (
    tenant_id, stripe_account_id,
    access_token_enc, refresh_token_enc,
    livemode, scope, connected_at
  ) VALUES (
    p_tenant_id, p_stripe_account_id,
    pgp_sym_encrypt(p_access_token, current_setting('app.encryption_key')),
    pgp_sym_encrypt(p_refresh_token, current_setting('app.encryption_key')),
    p_livemode, p_scope, NOW()
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    stripe_account_id = EXCLUDED.stripe_account_id,
    access_token_enc = EXCLUDED.access_token_enc,
    refresh_token_enc = EXCLUDED.refresh_token_enc,
    livemode = EXCLUDED.livemode,
    scope = EXCLUDED.scope,
    connected_at = NOW();
END;
$$;

GRANT EXECUTE ON FUNCTION tenant_stripe_connect_save(uuid, text, text, text, boolean, text) TO authenticated;

-- 3. RPC: tenant_stripe_connect_set_webhook — persists the auto-registered webhook endpoint ID.
CREATE OR REPLACE FUNCTION tenant_stripe_connect_set_webhook(
  p_tenant_id UUID,
  p_webhook_endpoint_id TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins
    WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  UPDATE tenant_stripe_connect
    SET webhook_endpoint_id = p_webhook_endpoint_id
    WHERE tenant_id = p_tenant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION tenant_stripe_connect_set_webhook(uuid, text) TO authenticated;

-- 4. RPC: tenant_stripe_connect_for_disconnect — returns decrypted access_token + ids for revocation.
--    Returns plaintext access_token only for the route handler that will immediately revoke.
CREATE OR REPLACE FUNCTION tenant_stripe_connect_for_disconnect(p_tenant_id UUID)
RETURNS TABLE (
  access_token TEXT,
  stripe_account_id TEXT,
  webhook_endpoint_id TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins
    WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    pgp_sym_decrypt(t.access_token_enc, current_setting('app.encryption_key'))::TEXT,
    t.stripe_account_id,
    t.webhook_endpoint_id
  FROM tenant_stripe_connect t
  WHERE t.tenant_id = p_tenant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION tenant_stripe_connect_for_disconnect(uuid) TO authenticated;

-- 5. RPC: tenant_stripe_connect_soft_delete — clears the row after disconnect.
CREATE OR REPLACE FUNCTION tenant_stripe_connect_soft_delete(p_tenant_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins
    WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  DELETE FROM tenant_stripe_connect WHERE tenant_id = p_tenant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION tenant_stripe_connect_soft_delete(uuid) TO authenticated;

-- 6. RPC: tenant_stripe_connect_decrypt — returns access_token for server routes.
--    Called by stripe-client.ts when it needs a Stripe SDK client scoped to the connected account.
CREATE OR REPLACE FUNCTION tenant_stripe_connect_decrypt(p_tenant_id UUID)
RETURNS TABLE (access_token TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  IF NOT EXISTS (
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
$$;

GRANT EXECUTE ON FUNCTION tenant_stripe_connect_decrypt(uuid) TO authenticated;
