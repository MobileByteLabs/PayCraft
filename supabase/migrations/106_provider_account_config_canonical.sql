-- 106_provider_account_config_canonical.sql
--
-- One name per identifier, and each identifier on the tier that owns it.
--
-- Two inconsistencies surfaced when the resolved config was first asserted end-to-end (the merged
-- config for a connected Play app contained no `client_email`, though the credential was right
-- there):
--
--   1. **Two names for one thing.** 103's own comment specifies `google_play={client_email}`, but
--      its backfill copied the key it found on `tenant_providers.store_config`, which was
--      `account_email`. Three live rows carry `account_email`; every reader written since expects
--      `client_email`. `client_email` wins because it is Google's own field name in the
--      service-account JSON — `account_email` is a local invention, and inventing a synonym for a
--      field that arrives pre-named is what produced the split.
--
--   2. **Account identifiers sitting in app scope.** The pre-103 keys route wrote everything to
--      `store_config`, so `account_email` and `account_label` — both properties of the CREDENTIAL,
--      not of the app — were duplicated onto every app using it. Left alone they are a second copy
--      that drifts the moment a connection is renamed, and (until 105 closed the anon grant) they
--      were the part of `tenant_provider_resolve`'s payload that mapped a tenant UUID to an
--      operator's email address.
--
-- App Store rows already carry `key_id` / `issuer_id` on the account and need no rename.
--
-- Idempotent: re-running finds no `account_email` to move and no app-scoped copies to strip.

-- ── 1. account_email → client_email on the ACCOUNT ───────────────────────────────────────────
UPDATE public.provider_accounts
SET config = (config - 'account_email') || jsonb_build_object('client_email', config->>'account_email'),
    updated_at = now()
WHERE provider = 'google_play'
  AND config ? 'account_email'
  AND NOT (config ? 'client_email');

-- A row carrying BOTH (a save that straddled the rename) keeps client_email and drops the synonym.
UPDATE public.provider_accounts
SET config = config - 'account_email',
    updated_at = now()
WHERE provider = 'google_play' AND config ? 'account_email' AND config ? 'client_email';

-- ── 2. Strip account-scoped identifiers from app scope ───────────────────────────────────────
-- Only where the app resolves to an account that actually holds the value: an un-migrated app whose
-- credential is still its own local blob must keep its copy, or its label disappears with nothing
-- to replace it.
UPDATE public.tenant_providers tp
SET store_config = tp.store_config - 'account_email' - 'account_label'
FROM public.provider_accounts pa
WHERE tp.provider_account_id = pa.id
  AND (tp.store_config ? 'account_email' OR tp.store_config ? 'account_label');

-- ── 3. Carry the label onto the account where only the app had one ───────────────────────────
-- 103 defaulted a backfilled connection's label from whatever it could find; where an app carried a
-- better one (the operator typed it) and the account is still on a generated name, prefer the typed
-- one. Runs BEFORE nothing — step 2 already removed the app copies, so this reads the account's own
-- value and is a no-op on a re-run.
UPDATE public.provider_accounts pa
SET label = COALESCE(NULLIF(btrim(pa.config->>'client_email'), ''), pa.label),
    updated_at = now()
WHERE pa.provider = 'google_play'
  AND (pa.label IS NULL OR btrim(pa.label) = '' OR pa.label = 'google_play connection');

COMMENT ON COLUMN public.provider_accounts.config IS
  'Non-secret ACCOUNT-scoped ids ONLY: app_store={key_id,issuer_id}, google_play={client_email}. Never package_name/bundle_id — those identify an APP and live on tenant_providers.store_config.';
