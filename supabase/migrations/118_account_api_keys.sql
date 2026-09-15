-- 118_account_api_keys.sql — hash-only, account-scoped API keys.
--
-- PayCraft's only keys today are `tenants.api_key_live/test`: publishable (`pk_live_…`), app-scoped,
-- and read-only against `/config`. Every mutating RPC authorizes on `auth.uid()` through
-- `tenant_admins`. That leaves no way for a headless caller to act AS an account, which is why
-- onboarding still required a human to sign in.
--
-- This table is the credential half of the fix. The other half is `functions/account-token`, which
-- exchanges a key for a 15-minute JWT carrying `sub = owner_user_id` — so every existing RPC, RLS
-- policy and `auth.uid()` guard keeps working untouched, and the surface migrations 105/107 swept
-- stays swept. Storing the key and letting callers hit the database directly would have meant either
-- service-role (bypasses RLS entirely) or a caller-supplied owner parameter, which is precisely the
-- anti-pattern 107 existed to remove.
--
-- ONLY the hash is stored. `key_hash_is_sha256_hex` is a structural bar: a bug that forgot to hash
-- cannot persist, because a `sk_acct_…` plaintext does not match 64 hex characters. AC-11 probes
-- exactly that with `select count(*) … where key_hash like 'sk_acct_%'` → 0.

CREATE TABLE IF NOT EXISTS public.account_api_keys (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_hash       TEXT NOT NULL UNIQUE,
  -- First 12 characters (`sk_acct_` + 4), shown in list views so an operator can tell two keys
  -- apart without the plaintext. Non-secret by construction: 4 base64url characters of a 32-byte
  -- key leave 2^232 unguessed.
  key_prefix     TEXT NOT NULL,
  label          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at   TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ
);

-- Constraints added separately + guarded so the migration is idempotent across `supabase db reset`
-- and partial-apply recovery (project CLAUDE.md § Database migrations).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'key_hash_is_sha256_hex') THEN
    ALTER TABLE public.account_api_keys
      ADD CONSTRAINT key_hash_is_sha256_hex CHECK (key_hash ~ '^[0-9a-f]{64}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'key_prefix_shape') THEN
    -- base64url alphabet INCLUDES '-' and '_'. A `[A-Za-z0-9]`-only class would reject roughly
    -- half of all generated keys at random, which would read as an intermittent issuance bug.
    ALTER TABLE public.account_api_keys
      ADD CONSTRAINT key_prefix_shape CHECK (key_prefix ~ '^sk_acct_[A-Za-z0-9_-]{4}$');
  END IF;
END
$$;

-- Partial index: the exchange path only ever looks up LIVE keys, so revoked rows stay out of it.
CREATE INDEX IF NOT EXISTS account_api_keys_active_by_owner
  ON public.account_api_keys (owner_user_id) WHERE revoked_at IS NULL;

ALTER TABLE public.account_api_keys ENABLE ROW LEVEL SECURITY;

-- An owner may READ their keys (metadata only — the plaintext is unrecoverable) and REVOKE them.
-- There is deliberately no INSERT policy: issuance runs service-role inside the dashboard route, so
-- no anon or authenticated caller can mint a credential for themselves by writing the table directly.
DROP POLICY IF EXISTS owner_read ON public.account_api_keys;
CREATE POLICY owner_read ON public.account_api_keys
  FOR SELECT USING (auth.uid() = owner_user_id);

DROP POLICY IF EXISTS owner_revoke ON public.account_api_keys;
CREATE POLICY owner_revoke ON public.account_api_keys
  FOR UPDATE USING (auth.uid() = owner_user_id)
          WITH CHECK (auth.uid() = owner_user_id);

-- Same defence in depth as 117. An API-key table is the last thing that should rely solely on a
-- policy being present.
REVOKE ALL ON public.account_api_keys FROM anon;

COMMENT ON TABLE public.account_api_keys IS
  'Account-scoped API keys, hash-only. Exchanged for a short-lived scoped JWT by functions/account-token; never used directly as a database credential.';
