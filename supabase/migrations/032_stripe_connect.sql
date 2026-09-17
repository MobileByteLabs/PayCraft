-- 032_stripe_connect.sql — Per-tenant Stripe Connect OAuth tokens (pgcrypto-encrypted)
BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenant_stripe_connect (
  tenant_id           UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  stripe_account_id   TEXT NOT NULL,
  access_token_enc    BYTEA NOT NULL,                    -- pgp_sym_encrypt(access_token, key)
  refresh_token_enc   BYTEA,
  livemode            BOOLEAN NOT NULL,
  scope               TEXT,
  connected_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  refreshed_at        TIMESTAMPTZ
);

ALTER TABLE tenant_stripe_connect ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_stripe_connect_read ON tenant_stripe_connect;
-- IMPORTANT: read returns metadata only (no encrypted columns surfaced) — encryption key
-- never crosses into the dashboard layer; only edge functions can decrypt.
CREATE POLICY tenant_stripe_connect_read ON tenant_stripe_connect FOR SELECT
  USING (tenant_id IN (SELECT ta.tenant_id FROM tenant_admins ta WHERE ta.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION tenant_stripe_connect_upsert(
  p_tenant_id       UUID,
  p_account_id      TEXT,
  p_access_token    TEXT,
  p_refresh_token   TEXT,
  p_livemode        BOOLEAN,
  p_scope           TEXT,
  p_encryption_key  TEXT
)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  INSERT INTO tenant_stripe_connect (
    tenant_id, stripe_account_id, access_token_enc,
    refresh_token_enc, livemode, scope
  )
  VALUES (
    p_tenant_id,
    p_account_id,
    pgp_sym_encrypt(p_access_token, p_encryption_key),
    CASE WHEN p_refresh_token IS NULL THEN NULL
         ELSE pgp_sym_encrypt(p_refresh_token, p_encryption_key) END,
    p_livemode,
    p_scope
  )
  ON CONFLICT (tenant_id) DO UPDATE
    SET stripe_account_id  = EXCLUDED.stripe_account_id,
        access_token_enc   = EXCLUDED.access_token_enc,
        refresh_token_enc  = EXCLUDED.refresh_token_enc,
        livemode           = EXCLUDED.livemode,
        scope              = EXCLUDED.scope,
        refreshed_at       = now();
END;
$$;

-- Decryption helper — only callable by service_role (edge functions).
CREATE OR REPLACE FUNCTION tenant_stripe_connect_decrypt(
  p_tenant_id      UUID,
  p_encryption_key TEXT
)
RETURNS TABLE(stripe_account_id TEXT, access_token TEXT, livemode BOOLEAN)
LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public, extensions
AS $$
  SELECT stripe_account_id,
         pgp_sym_decrypt(access_token_enc, p_encryption_key)::TEXT,
         livemode
    FROM tenant_stripe_connect
   WHERE tenant_id = p_tenant_id;
$$;

CREATE OR REPLACE FUNCTION tenant_stripe_connect_disconnect(p_tenant_id UUID)
RETURNS VOID
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM tenant_stripe_connect WHERE tenant_id = p_tenant_id;
$$;

COMMIT;
