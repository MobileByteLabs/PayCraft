-- Migration 055 — move encryption key out of GUC into a config table.
--
-- The previous attempt (054) tried `ALTER DATABASE postgres SET app.encryption_key`
-- but Supabase's local `postgres` role doesn't have permission to write GUC
-- parameters under the `app.*` namespace. That left the dashboard's "Save
-- Stripe keys" flow blowing up with:
--
--   unrecognized configuration parameter "app.encryption_key"
--
-- This migration sidesteps the GUC mechanism entirely by stashing the
-- encryption passphrase in a tiny singleton table (paycraft_secrets_config).
-- The table is service-role only via RLS; tenant_admins / authenticated users
-- can NOT read it. The encrypt/decrypt functions resolve the passphrase from
-- the table on every call.
--
-- Production deployments override the default by running:
--   UPDATE paycraft_secrets_config SET passphrase = '<long-random>' WHERE id = TRUE;
-- BEFORE any data is encrypted. Rotating after encryption orphans every row.

CREATE TABLE IF NOT EXISTS public.paycraft_secrets_config (
  id          BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE), -- singleton
  passphrase  TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO public.paycraft_secrets_config (id, passphrase)
VALUES (TRUE, 'paycraft-local-dev-passphrase-CHANGE-IN-PROD')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.paycraft_secrets_config ENABLE ROW LEVEL SECURITY;
-- No policies: only service_role + SECURITY DEFINER functions can read.

-- ---------------------------------------------------------------------------
-- Re-define encrypt_provider_key + decrypt_provider_key to use the table.
-- decrypt_provider_key already existed from migration 022 — we re-create it
-- with the new resolver too so test/live key fetches still work.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.encrypt_provider_key(p_key TEXT)
RETURNS BYTEA
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_passphrase TEXT;
BEGIN
  SELECT passphrase INTO v_passphrase FROM paycraft_secrets_config WHERE id = TRUE;
  IF v_passphrase IS NULL OR v_passphrase = '' THEN
    RAISE EXCEPTION 'paycraft_secrets_config.passphrase is empty. Seed it before saving secrets.';
  END IF;
  RETURN pgp_sym_encrypt(p_key, v_passphrase);
END;
$$;

-- DROP the prior signature first — the earlier migration used `p_enc` as
-- the parameter name; Postgres refuses to rename input params via
-- CREATE OR REPLACE so we drop and recreate.
DROP FUNCTION IF EXISTS public.decrypt_provider_key(BYTEA);

CREATE OR REPLACE FUNCTION public.decrypt_provider_key(p_encrypted BYTEA)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_passphrase TEXT;
BEGIN
  SELECT passphrase INTO v_passphrase FROM paycraft_secrets_config WHERE id = TRUE;
  IF v_passphrase IS NULL OR v_passphrase = '' THEN
    RAISE EXCEPTION 'paycraft_secrets_config.passphrase is empty.';
  END IF;
  RETURN pgp_sym_decrypt(p_encrypted, v_passphrase);
END;
$$;

-- platform_secrets_get already exists and calls pgp_sym_decrypt directly with
-- current_setting() — re-define so it reads the passphrase from the table too.
CREATE OR REPLACE FUNCTION public.platform_secrets_get(p_key TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public, extensions
AS $$
DECLARE
  v_encrypted  BYTEA;
  v_passphrase TEXT;
BEGIN
  IF NOT (is_platform_owner() OR auth.role() = 'service_role') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT encrypted_value INTO v_encrypted FROM platform_secrets WHERE key = p_key;
  IF v_encrypted IS NULL THEN RETURN NULL; END IF;

  SELECT passphrase INTO v_passphrase FROM paycraft_secrets_config WHERE id = TRUE;
  IF v_passphrase IS NULL OR v_passphrase = '' THEN
    RAISE EXCEPTION 'paycraft_secrets_config.passphrase is empty.';
  END IF;

  RETURN pgp_sym_decrypt(v_encrypted, v_passphrase);
END;
$$;
