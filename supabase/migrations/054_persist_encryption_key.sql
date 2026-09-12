-- Migration 054 — NO-OP (superseded by 055).
--
-- The original 054 attempted to persist the encryption passphrase via
-- `ALTER DATABASE postgres SET app.encryption_key = …`. That requires SUPERUSER
-- against the local Supabase database, which `supabase migration up` doesn't
-- run as — every fresh checkout failed with:
--
--   ERROR: permission denied to set parameter "app.encryption_key" (SQLSTATE 42501)
--
-- Migration 055 supersedes this with a `paycraft_secrets_config` table that
-- `encrypt_provider_key` / `decrypt_provider_key` read from instead of a GUC,
-- which sidesteps the privilege requirement entirely.
--
-- This file is kept as an applied no-op so the migration ledger stays linear
-- across fresh clones, snapshot dumps, and CI runs. Do not reintroduce
-- `ALTER DATABASE` here — fork 055 if you need to change the passphrase model.

SELECT 1;
