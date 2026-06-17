-- Migration 053 — Platform-level secrets + ownership.
--
-- For Stripe Connect OAuth to work, PayCraft's instance (paycraft.mobilebytesensei.com or any
-- self-hosted deployment) needs a one-time pair of platform credentials:
--   - STRIPE_CONNECT_CLIENT_ID  (ca_…)
--   - STRIPE_SECRET_KEY         (sk_live_… or sk_test_…)
--
-- Pre-053 these were read from env vars. That's fine for paycraft.mobilebytesensei.com where
-- the deployer sets them at boot, but for self-hosted single-machine setups we
-- want a hot-configurable path so the deployer can wire them through the
-- dashboard without restarting Node. This migration provides:
--
--   - platform_settings  — singleton row; tracks who the platform owner is
--   - platform_secrets   — key→encrypted_value (uses existing encrypt_provider_key)
--   - claim_platform_owner()       — idempotent self-claim by first user
--   - is_platform_owner()          — auth.uid() == owner?
--   - platform_secrets_set/get/list — admin-only writers + readers

-- ---------------------------------------------------------------------------
-- 1. platform_settings — singleton (id = TRUE is the only allowed row)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_settings (
  id                     BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
  platform_owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

-- Anyone authenticated can READ — the dashboard needs this to decide whether
-- to render the "configure platform keys" CTA. We don't expose the owner's
-- email — only their user_id, which is harmless.
DROP POLICY IF EXISTS "platform_settings_authenticated_select" ON public.platform_settings;
CREATE POLICY "platform_settings_authenticated_select"
  ON public.platform_settings FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ---------------------------------------------------------------------------
-- 2. platform_secrets — encrypted key/value store for global PayCraft secrets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.platform_secrets (
  key             TEXT PRIMARY KEY,            -- e.g. "stripe_connect_client_id"
  encrypted_value BYTEA NOT NULL,              -- pgp_sym_encrypt(plain, app.encryption_key)
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by      UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

COMMENT ON TABLE public.platform_secrets IS
  'Singleton-style global secrets (Stripe Connect platform credentials, etc.). NEVER expose values without going through platform_secrets_get(). pgcrypto encryption matches tenant_providers.';

ALTER TABLE public.platform_secrets ENABLE ROW LEVEL SECURITY;
-- No direct SELECT — values only fetched via platform_secrets_get() RPC.

-- ---------------------------------------------------------------------------
-- 3. claim_platform_owner — the very first authenticated user to call this
--    becomes the platform owner. Idempotent (returns existing owner on subsequent calls).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.claim_platform_owner()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_existing UUID;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;

  INSERT INTO platform_settings (id, platform_owner_user_id)
  VALUES (TRUE, v_user_id)
  ON CONFLICT (id) DO NOTHING;

  SELECT platform_owner_user_id INTO v_existing FROM platform_settings WHERE id = TRUE;

  -- If the row already existed with NULL owner, set this caller as owner.
  IF v_existing IS NULL THEN
    UPDATE platform_settings SET platform_owner_user_id = v_user_id, updated_at = NOW() WHERE id = TRUE;
    v_existing := v_user_id;
  END IF;

  RETURN v_existing;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_platform_owner() TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. is_platform_owner — light check used by RLS + dashboard.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_platform_owner()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM platform_settings
    WHERE id = TRUE AND platform_owner_user_id = auth.uid()
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_platform_owner() TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. platform_secrets_set/get/list — admin-only operations.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.platform_secrets_set(
  p_key       TEXT,
  p_plaintext TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
BEGIN
  IF NOT is_platform_owner() THEN
    RAISE EXCEPTION 'forbidden — only the platform owner can write secrets';
  END IF;

  INSERT INTO platform_secrets (key, encrypted_value, updated_at, updated_by)
  VALUES (p_key, encrypt_provider_key(p_plaintext), NOW(), v_caller)
  ON CONFLICT (key) DO UPDATE
    SET encrypted_value = EXCLUDED.encrypted_value,
        updated_at      = NOW(),
        updated_by      = v_caller;
END;
$$;

GRANT EXECUTE ON FUNCTION public.platform_secrets_set(TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.platform_secrets_get(p_key TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
DECLARE
  v_encrypted BYTEA;
BEGIN
  -- Allow service_role (used by server-side route handlers when running with
  -- the platform's service key) OR the platform owner.
  IF NOT (
    is_platform_owner()
    OR auth.role() = 'service_role'
  ) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT encrypted_value INTO v_encrypted
  FROM platform_secrets
  WHERE key = p_key;

  IF v_encrypted IS NULL THEN RETURN NULL; END IF;

  RETURN pgp_sym_decrypt(v_encrypted, current_setting('app.encryption_key'));
END;
$$;

GRANT EXECUTE ON FUNCTION public.platform_secrets_get(TEXT) TO authenticated, service_role;

-- platform_secrets_list — returns key + has_value (BOOL) + updated_at so the
-- dashboard wizard can render which slots are configured without revealing
-- values. NEVER returns the plaintext.
CREATE OR REPLACE FUNCTION public.platform_secrets_list()
RETURNS TABLE (
  key        TEXT,
  has_value  BOOLEAN,
  updated_at TIMESTAMPTZ
)
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
BEGIN
  IF NOT is_platform_owner() THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
    SELECT s.key, TRUE AS has_value, s.updated_at
    FROM platform_secrets s
    ORDER BY s.key;
END;
$$;

GRANT EXECUTE ON FUNCTION public.platform_secrets_list() TO authenticated;

-- ---------------------------------------------------------------------------
-- 6. Bootstrap encryption key — ensure app.encryption_key is set on this DB.
--    For local dev we fall back to PAYCRAFT_OAUTH_STATE_SECRET-equivalent.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF current_setting('app.encryption_key', TRUE) IS NULL
     OR current_setting('app.encryption_key', TRUE) = '' THEN
    -- For local dev: stable known passphrase. Production deployments should
    -- override via ALTER DATABASE ... SET app.encryption_key = '<long random>'.
    PERFORM set_config('app.encryption_key', 'paycraft-local-dev-passphrase', FALSE);
  END IF;
END $$;
