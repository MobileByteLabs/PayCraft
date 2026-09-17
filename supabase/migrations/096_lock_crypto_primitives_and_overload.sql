-- 096_lock_crypto_primitives_and_overload.sql
--
-- Closes the two holes that a LIVE PRIVILEGE PROBE found and static analysis of the migration files
-- did not. Both are worth recording, because the way they were missed is the lesson.
--
-- ── HOLE 1: decrypt_provider_key is an unguarded decryption oracle ───────────────────────────
-- decrypt_provider_key(p_encrypted bytea) loads the server passphrase from paycraft_secrets_config
-- and returns pgp_sym_decrypt(p_encrypted, passphrase). It has NO authorisation check of any kind,
-- and anon holds EXECUTE. Anyone with the PUBLIC anon key can hand it arbitrary ciphertext and get
-- plaintext back.
--
-- It is the primitive the guarded RPCs are built on: tenant_providers_decrypt_key and
-- tenant_stripe_connect_decrypt both check tenant_admins + auth.uid() before decrypting, and
-- tenant_providers_decrypt_for_webhook requires role=service_role. Those three are sound. But the
-- primitive underneath them was reachable directly, so the guards could be walked around by calling
-- the layer below — the classic shape where every door is locked and the wall is missing.
--
-- Static review could not see this. The file-level scan classified functions by whether their body
-- writes rows; decrypt_provider_key only READS and returns, so it never appeared in any writer list.
-- Its danger is disclosure, not mutation. Only asking the database "what can anon actually execute?"
-- surfaced it.
--
-- Safe to revoke: dashboard, Edge Functions and the SDK call it ZERO times (grep across all three).
-- Its only callers are the three SECURITY DEFINER functions above, which execute as the DEFINER and
-- therefore do not consult the caller's EXECUTE privilege at all. Verified: all three have
-- pg_proc.prosecdef = true.
--
-- encrypt_provider_key and decrypt_provider_key_masked are locked for the same reason — same family,
-- same zero external callers. paycraft_encryption_passphrase_is_default() is included because it
-- tells an unauthenticated caller whether the deployment still runs the default passphrase, which is
-- reconnaissance for exactly this attack.
--
-- ── HOLE 2: a second upgrade_tenant_plan overload was never revoked ──────────────────────────
-- 094 revoked upgrade_tenant_plan(UUID, TEXT). The database also carries
-- upgrade_tenant_plan(UUID, TEXT, INTEGER, TEXT, TEXT, TIMESTAMPTZ) — a live overload from an
-- earlier migration that 094 left wide open to anon. Escalating a tenant's billing plan was still
-- one anon RPC call away, and the probe showed the two rows side by side: one 'f', one 't'.
--
-- The arity check run against 094 compared each revoke to the LATEST CREATE of that name and
-- reported "ALL ARITIES MATCH". It had no way to notice that an OLDER signature also still exists —
-- Postgres keeps every overload, and CREATE OR REPLACE of a different arity adds rather than
-- replaces. Signature checks must enumerate pg_proc, not the migration text.
--
-- Idempotent; safe to re-apply.

-- ── Crypto primitives — internal use only ────────────────────────────────────────────────────
-- No GRANT follows. These need no role: every legitimate caller is SECURITY DEFINER and runs as the
-- function owner. Granting service_role "just in case" would re-open a decryption oracle to any
-- holder of the service key for no caller that exists.
REVOKE EXECUTE ON FUNCTION public.decrypt_provider_key(bytea)                 FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.decrypt_provider_key_masked(bytea)          FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.encrypt_provider_key(text)                  FROM anon, authenticated, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.paycraft_encryption_passphrase_is_default() FROM anon, authenticated, PUBLIC;

-- ── The overload 094 missed ──────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.upgrade_tenant_plan(UUID, TEXT, INTEGER, TEXT, TEXT, TIMESTAMPTZ)
  FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.upgrade_tenant_plan(UUID, TEXT, INTEGER, TEXT, TEXT, TIMESTAMPTZ)
  TO service_role;
