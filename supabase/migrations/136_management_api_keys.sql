-- 136_management_api_keys.sql
--
-- Secret, scoped, revocable API keys for MACHINE access to PayCraft (CI, agents, third parties).
--
-- WHY THIS EXISTS
-- Every admin surface authenticates with `auth.getUser()` and every admin RPC gates on
-- `auth.uid() IN tenant_admins`. That is correct for humans and a dead end for machines: the owner
-- account signs in with Google, which has no password, and Google refuses automated browsers
-- outright ("This browser or app may not be secure"). So there is currently NO way to run product
-- sync — or any admin operation — without a human at a keyboard.
--
-- WHY NOT REUSE THE EXISTING KEYS
-- `tenants.api_key_test` / `api_key_live` (`pk_…`) are PUBLIC by design: the SDK embeds them in
-- every shipped client binary. They are also stored in PLAINTEXT and compared directly (015). They
-- must never gain admin power — a key in an APK that can bulk-write to live payment providers is a
-- breach waiting to happen. Hence a separate, secret key class.
--
-- PREFIX `pcsk_`, deliberately
-- Not `sk_` (reads as a Stripe secret key, and these live side by side in the same tables and logs)
-- and not `pk_` (that is the public SDK key). A key's blast radius should be legible from its first
-- six characters, by a human skimming a log or a leaked file.
--
-- STORED AS A HASH
-- Only sha256(key) is persisted, so a database dump does not yield usable credentials — unlike the
-- pk_ columns. sha256 without a salt or KDF is the correct choice HERE and would be wrong for a
-- password: the key is 32 bytes of CSPRNG output, so there is no dictionary to attack and no
-- entropy to stretch. Lookup is an indexed equality on the hash of the PRESENTED key, so there is
-- no timing oracle over the stored secret either.
--
-- The plaintext is returned EXACTLY ONCE, by the create RPC. There is no endpoint that can read a
-- key back, because one that could would undo everything above.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenant_api_keys (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  -- Display fingerprint: enough to identify WHICH key a row refers to, useless for authenticating.
  key_prefix    TEXT NOT NULL,
  key_hash      TEXT NOT NULL UNIQUE,
  scopes        TEXT[] NOT NULL DEFAULT '{}',
  created_by    UUID,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at  TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS tenant_api_keys_tenant ON tenant_api_keys(tenant_id, created_at DESC);
-- Partial index: verification only ever looks at keys that are still usable.
CREATE INDEX IF NOT EXISTS tenant_api_keys_active ON tenant_api_keys(key_hash) WHERE revoked_at IS NULL;

-- The scope vocabulary is CLOSED. An unknown scope is a typo or an attempt, and either way a key
-- carrying it must not be created — a permission system that silently accepts unknown permissions
-- grants nothing today and anything tomorrow, when some route starts honouring the string.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_api_keys_scopes_known') THEN
    ALTER TABLE tenant_api_keys ADD CONSTRAINT tenant_api_keys_scopes_known CHECK (
      scopes <@ ARRAY[
        'providers:read',
        'products:read',
        'products:sync',
        'readiness:read'
      ]::TEXT[]
    );
  END IF;
END $$;

ALTER TABLE tenant_api_keys ENABLE ROW LEVEL SECURITY;

-- Admins may LIST their tenant's keys (metadata only — the hash is useless without a preimage and
-- the plaintext was never stored). No INSERT/UPDATE policy: creation and revocation go through the
-- SECURITY DEFINER functions below, so the generation path cannot be bypassed with a hand-crafted
-- row carrying, say, a hash the caller chose.
DROP POLICY IF EXISTS tenant_api_keys_read ON tenant_api_keys;
CREATE POLICY tenant_api_keys_read ON tenant_api_keys FOR SELECT
  USING (EXISTS (SELECT 1 FROM tenant_admins ta
                 WHERE ta.tenant_id = tenant_api_keys.tenant_id AND ta.user_id = auth.uid()));

-- ── create ────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_api_key_create(
  p_tenant_id  UUID,
  p_name       TEXT,
  p_scopes     TEXT[],
  p_expires_at TIMESTAMPTZ DEFAULT NULL
)
RETURNS TABLE (id UUID, api_key TEXT, key_prefix TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_key    TEXT;
  v_prefix TEXT;
  v_id     UUID;
BEGIN
  -- Either a tenant admin, OR the service role.
  --
  -- The admin check is what stops a logged-in user minting keys for someone else's tenant, and it
  -- stays exactly as strict. The service_role branch exists because of a real bootstrap problem:
  -- the FIRST key cannot be created by a key that does not exist yet, and the owner account signs
  -- in with Google, which cannot be automated. Without this branch the feature can only be used by
  -- a human clicking in the dashboard, which is the very limitation it was built to remove.
  --
  -- It grants no new power. service_role already bypasses RLS and can read and write every table
  -- directly, including this one — so it could forge a key row by hand regardless. Routing it
  -- through this function instead means the generation path, the hashing and the audit row are the
  -- same ones a human gets, rather than a hand-rolled INSERT that skips all three.
  IF auth.role() IS DISTINCT FROM 'service_role'
     AND NOT EXISTS (
       SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
     ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  IF COALESCE(array_length(p_scopes, 1), 0) = 0 THEN
    RAISE EXCEPTION 'scopes_required';
  END IF;

  -- 32 bytes of CSPRNG. Not a UUID: v4 carries ~122 bits with a recognisable shape, and these are
  -- bearer credentials for live-money operations.
  v_key    := 'pcsk_' || encode(gen_random_bytes(32), 'hex');
  v_prefix := left(v_key, 13) || '…';

  INSERT INTO tenant_api_keys (tenant_id, name, key_prefix, key_hash, scopes, created_by, expires_at)
  VALUES (p_tenant_id, p_name, v_prefix,
          encode(digest(v_key, 'sha256'), 'hex'),
          p_scopes, auth.uid(), p_expires_at)
  RETURNING tenant_api_keys.id INTO v_id;

  PERFORM audit_log_emit(p_tenant_id, auth.uid(),
                         CASE WHEN auth.uid() IS NULL THEN 'system' ELSE 'user' END,
                         'api_key.created',
                         'tenant_api_keys:id=' || v_id::TEXT, NULL,
                         jsonb_build_object('name', p_name, 'scopes', p_scopes, 'prefix', v_prefix));

  -- The only time the plaintext is ever returned.
  RETURN QUERY SELECT v_id, v_key, v_prefix;
END;
$$;

-- ── verify (service_role only — this is the authentication primitive) ─────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_api_key_verify(p_key TEXT)
RETURNS TABLE (tenant_id UUID, key_id UUID, scopes TEXT[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row RECORD;
BEGIN
  SELECT k.* INTO v_row FROM tenant_api_keys k
  WHERE k.key_hash = encode(digest(p_key, 'sha256'), 'hex')
    AND k.revoked_at IS NULL
    AND (k.expires_at IS NULL OR k.expires_at > now());

  IF v_row.id IS NULL THEN RETURN; END IF;   -- zero rows = caller renders 401; never a partial hit

  UPDATE tenant_api_keys SET last_used_at = now() WHERE tenant_api_keys.id = v_row.id;

  RETURN QUERY SELECT v_row.tenant_id, v_row.id, v_row.scopes;
END;
$$;

-- ── revoke ────────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_api_key_revoke(p_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
BEGIN
  SELECT k.tenant_id INTO v_tenant FROM tenant_api_keys k WHERE k.id = p_id;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'unknown_key'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = v_tenant AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  UPDATE tenant_api_keys SET revoked_at = now() WHERE id = p_id AND revoked_at IS NULL;

  PERFORM audit_log_emit(v_tenant, auth.uid(), 'user', 'api_key.revoked',
                         'tenant_api_keys:id=' || p_id::TEXT, NULL, NULL);
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.tenant_api_key_verify(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_api_key_verify(TEXT) TO service_role;

REVOKE ALL ON FUNCTION public.tenant_api_key_create(UUID, TEXT, TEXT[], TIMESTAMPTZ) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_api_key_create(UUID, TEXT, TEXT[], TIMESTAMPTZ) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.tenant_api_key_revoke(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_api_key_revoke(UUID) TO authenticated, service_role;

COMMIT;
