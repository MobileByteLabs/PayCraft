-- Migration 150: ACCOUNT-scoped management keys — one token that reaches every app you own.
--
-- WHY. `pcsk_` keys (migration 136) are bound to exactly ONE tenant: `tenant_api_keys.tenant_id` is
-- NOT NULL and `tenant_api_key_verify` returns that single id, which every REST route and MCP tool
-- then uses. An operator who owns several apps therefore needs one key per app — measured on
-- production 2026-10-08, one account owns SEVEN (Affirmly, cappy, Hacker Keyboard, PayCraft Sample,
-- Reels Downloader, Status Saver, test). Tooling that onboards "any app end to end" cannot be asked
-- to hold seven bearer credentials.
--
-- This models Supabase's own Personal Access Tokens: named, expiring, SCOPED, with resource access
-- chosen at creation and permissions defaulting to nothing.
--
-- WHY EXTEND 136 RATHER THAN ADD A KEY TYPE. The table already has name / scopes[] / expires_at /
-- last_used_at / revoked_at / key_prefix — everything a PAT needs except account reach. A parallel
-- mechanism is exactly how `account_api_keys` (migration 118, `sk_acct_`) ended up orphaned: it is
-- account-level but no REST or MCP route accepts it, because auth only knows `pcsk_`. One
-- mechanism, two scopes.
--
-- THE SHAPE
--   tenant_id IS NOT NULL  → app-scoped  (unchanged; every existing key and route behaves as before)
--   tenant_id IS NULL      → account-scoped, reach derived LIVE from tenant_admins for owner_user_id
--
-- Deriving reach live rather than snapshotting a tenant list is deliberate: removing someone from
-- an app must remove their token's reach to it in the same instant. A stored list would keep
-- granting access to an app the owner no longer administers.
--
-- SAFETY PROPERTIES MADE STRUCTURAL, not conventional:
--   • An account key MUST expire. `expires_at` is nullable for app keys (existing rows rely on it),
--     so the NOT NULL is enforced by CHECK only for the account-scoped shape.
--   • Scopes still default to '{}' and remain CHECK-constrained; an empty scope set authorises
--     nothing. Creation refuses an empty set, as it already did.
--   • Exactly one of tenant_id / owner_user_id is set — a row cannot be both, or neither.
--
-- Idempotent. No DROP; `tenant_api_key_verify` is REPLACED with a wider RETURNS TABLE, which is why
-- the old signature must be dropped first (Postgres cannot change a function's return type in
-- place). That is the one unavoidable drop, and it is safe because the function is called only by
-- the dashboard's own auth helper via service_role — there is no third-party caller to break.

-- ── 1. account-scoped rows ────────────────────────────────────────────────────────────────────
ALTER TABLE tenant_api_keys ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE tenant_api_keys ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

DO $$
BEGIN
  -- Exactly one scope dimension. Prevents a row that is both app- and account-scoped (ambiguous
  -- reach) or neither (a key that authenticates and reaches nothing).
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_api_keys_one_scope') THEN
    ALTER TABLE tenant_api_keys ADD CONSTRAINT tenant_api_keys_one_scope CHECK (
      (tenant_id IS NOT NULL AND owner_user_id IS NULL)
      OR (tenant_id IS NULL AND owner_user_id IS NOT NULL)
    );
  END IF;

  -- An account key reaches every app its owner administers, so an unbounded lifetime is a standing
  -- liability. App keys keep the nullable column for backward compatibility.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_api_keys_account_expires') THEN
    ALTER TABLE tenant_api_keys ADD CONSTRAINT tenant_api_keys_account_expires CHECK (
      owner_user_id IS NULL OR expires_at IS NOT NULL
    );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS tenant_api_keys_owner ON tenant_api_keys(owner_user_id, created_at DESC)
  WHERE owner_user_id IS NOT NULL;

-- ── 2. scope vocabulary: the write side the onboarding path needs ─────────────────────────────
-- Onboarding an app end to end provisions it, writes paywall/product configuration and rotates
-- keys — none of which any existing scope covers.
--
-- THE LIST BELOW IS A UNION, AND MUST STAY ONE. A CHECK constraint cannot be extended in place, so
-- widening means DROP + recreate, and recreating from a REMEMBERED list silently narrows it. The
-- first attempt at this migration rebuilt the list from migration 136 (four scopes) and was
-- rejected by Postgres — `check constraint … is violated by some row` — because migrations after
-- 136 had grown it to ten and live keys held all ten. The transaction rolled back cleanly and
-- nothing applied, which is the only reason that mistake cost nothing.
--
-- So: the ten below are the LIVE set read back from pg_constraint, not retyped from a migration
-- file, plus the six this migration adds. Before editing, read the live definition again:
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='tenant_api_keys_scopes_known';
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_api_keys_scopes_known') THEN
    ALTER TABLE tenant_api_keys DROP CONSTRAINT tenant_api_keys_scopes_known;
  END IF;
  ALTER TABLE tenant_api_keys ADD CONSTRAINT tenant_api_keys_scopes_known CHECK (
    scopes <@ ARRAY[
      -- pre-existing (all ten in live use as of 2026-10-08)
      'providers:read',
      'products:read',
      'products:sync',
      'readiness:read',
      'tenant:read',
      'subscribers:read',
      'coupons:read',
      'paywall:read',
      'audit:read',
      'webhooks:read',
      -- added by 150: the write side, kept separate from the read scopes so a reporting token
      -- can never provision an app or rotate a credential
      'products:write',
      'paywall:write',
      'providers:write',
      'apps:read',
      'apps:provision',
      'keys:rotate'
    ]::TEXT[]
  );
END $$;

-- ── 3. create an ACCOUNT key ──────────────────────────────────────────────────────────────────
-- Separate function rather than a nullable arg on tenant_api_key_create: that function's first
-- parameter is the tenant and every caller passes it positionally. A distinct name also makes the
-- audit trail read unambiguously.
CREATE OR REPLACE FUNCTION public.account_api_key_create(
  p_name       TEXT,
  p_scopes     TEXT[],
  p_expires_at TIMESTAMPTZ
)
RETURNS TABLE (id UUID, api_key TEXT, key_prefix TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_key     TEXT;
  v_id      UUID;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'unauthenticated'; END IF;
  IF COALESCE(array_length(p_scopes, 1), 0) = 0 THEN RAISE EXCEPTION 'scopes_required'; END IF;
  IF p_expires_at IS NULL THEN RAISE EXCEPTION 'expiry_required'; END IF;
  IF p_expires_at <= now() THEN RAISE EXCEPTION 'expiry_in_past'; END IF;

  -- Must already administer something, else the key reaches nothing and its existence is a
  -- misleading artefact.
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE user_id = v_user_id AND role IN ('owner','admin')
  ) THEN
    RAISE EXCEPTION 'no_administered_tenants';
  END IF;

  v_key := 'pcsk_' || encode(gen_random_bytes(32), 'hex');

  INSERT INTO tenant_api_keys (tenant_id, owner_user_id, name, key_prefix, key_hash, scopes, created_by, expires_at)
  VALUES (
    NULL, v_user_id, p_name,
    left(v_key, 12),
    encode(digest(v_key, 'sha256'), 'hex'),
    p_scopes, v_user_id, p_expires_at
  )
  RETURNING tenant_api_keys.id INTO v_id;

  RETURN QUERY SELECT v_id, v_key, left(v_key, 12);
END;
$$;

COMMENT ON FUNCTION public.account_api_key_create(TEXT, TEXT[], TIMESTAMPTZ) IS
  'Create an ACCOUNT-scoped pcsk_ key reaching every tenant the caller administers. Expiry and a '
  'non-empty scope set are mandatory; reach is resolved live from tenant_admins at verify time.';

-- ── 4. verify: return the REACHABLE TENANT SET, not a single id ───────────────────────────────
DROP FUNCTION IF EXISTS public.tenant_api_key_verify(TEXT);

CREATE OR REPLACE FUNCTION public.tenant_api_key_verify(p_key TEXT)
RETURNS TABLE (tenant_id UUID, key_id UUID, scopes TEXT[], account_scoped BOOLEAN, tenant_ids UUID[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row RECORD;
  v_ids UUID[];
BEGIN
  SELECT k.* INTO v_row FROM tenant_api_keys k
  WHERE k.key_hash = encode(digest(p_key, 'sha256'), 'hex')
    AND k.revoked_at IS NULL
    AND (k.expires_at IS NULL OR k.expires_at > now());

  IF v_row.id IS NULL THEN RETURN; END IF;   -- zero rows = caller renders 401; never a partial hit

  UPDATE tenant_api_keys SET last_used_at = now() WHERE tenant_api_keys.id = v_row.id;

  IF v_row.owner_user_id IS NULL THEN
    -- App-scoped: unchanged shape. tenant_ids carries the single id so callers have one code path.
    RETURN QUERY SELECT v_row.tenant_id, v_row.id, v_row.scopes, FALSE, ARRAY[v_row.tenant_id];
    RETURN;
  END IF;

  -- Account-scoped: reach computed NOW from tenant_admins, so losing admin loses reach instantly.
  SELECT COALESCE(array_agg(ta.tenant_id ORDER BY ta.tenant_id), '{}')
    INTO v_ids
    FROM tenant_admins ta
   WHERE ta.user_id = v_row.owner_user_id AND ta.role IN ('owner','admin');

  -- tenant_id is NULL for an account key ON PURPOSE: a caller that still reads a single tenant_id
  -- gets NULL and must fail, rather than silently acting on an arbitrary app.
  RETURN QUERY SELECT NULL::UUID, v_row.id, v_row.scopes, TRUE, v_ids;
END;
$$;

COMMENT ON FUNCTION public.tenant_api_key_verify(TEXT) IS
  'Verify a pcsk_ key. App-scoped keys return their one tenant; account-scoped keys return '
  'tenant_id = NULL plus the live reachable set, so a caller reading a single id fails loudly '
  'instead of guessing an app (migration 150).';

-- ── 5. list / revoke for the dashboard UI ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.account_api_keys_list()
RETURNS TABLE (id UUID, name TEXT, key_prefix TEXT, scopes TEXT[],
               created_at TIMESTAMPTZ, last_used_at TIMESTAMPTZ, expires_at TIMESTAMPTZ)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT k.id, k.name, k.key_prefix, k.scopes, k.created_at, k.last_used_at, k.expires_at
  FROM tenant_api_keys k
  WHERE k.owner_user_id = auth.uid() AND k.revoked_at IS NULL
  ORDER BY k.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION public.account_api_key_create(TEXT, TEXT[], TIMESTAMPTZ) TO authenticated;
GRANT EXECUTE ON FUNCTION public.account_api_keys_list()                           TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_api_key_verify(TEXT)                       TO service_role;
