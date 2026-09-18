-- 127_drop_uncalled_rpcs.sql
--
-- Remove five functions that are granted to `authenticated` and called by nothing.
--
-- These were found by the RS-4 reachability check, which reads every GRANT ... TO authenticated out
-- of the migration history and looks for an invocation anywhere in the app, the SDK, the edge
-- functions or the command runtimes. A function in that state is not a feature — it is public
-- surface an attacker can call and a reader mistakes for working behaviour.
--
-- The rule applied here is the same one used for tenant_routing_ensure_defaults in migration 126: a
-- granted RPC with no caller is REMOVED, and if the capability is wanted it comes back in the same
-- change as the caller that needs it. "Keep it, we might wire it up" is how all five got here.
--
-- WHAT EACH ONE WAS, AND WHY IT GOES
--
--   account_pricing_template_get / _save
--     An account-level pricing template: multipliers + rounding per country, saved once and applied
--     to every product. Nothing reads or writes it — not the RPCs, not the `account_pricing_template`
--     table, not the locale matrix UI that would be its natural consumer. The multipliers it was
--     meant to hold are live today by another route: migration 122 mirrors DEFAULT_BANDS into
--     `pricing_bands` and 123 seeds per-currency prices from it, which is why no one missed these.
--
--   tenant_products_unsynced
--     Returned the products not yet pushed to a given provider. Superseded by the drift detectors in
--     dashboard/lib/drift-detectors.ts, which answer the same question with a richer verdict (reason,
--     action hint, per-provider skip cause) and are what the sync surfaces actually call.
--
--   get_tenant_usage
--     Backed GET /api/usage, which had no caller and is deleted in this change. No usage UI exists.
--
--   rotate_api_key
--     Backed POST /api/rotate-key, also deleted here. Key rotation is live at /api/api-keys/rotate,
--     which does the update inline and emits an audit row — it never called this function.
--
-- The `account_pricing_template` TABLE is deliberately left in place. Dropping a function removes
-- behaviour; dropping a table removes data, and an empty table costs nothing to keep while an
-- accidental data loss cannot be undone. If it is still empty at the next schema sweep, it can go
-- then, on purpose.

-- Signatures read from the live catalogue, not guessed: DROP FUNCTION IF EXISTS with the wrong
-- argument list succeeds silently and leaves the function in place, which would make this migration
-- look applied while changing nothing.
DROP FUNCTION IF EXISTS public.account_pricing_template_get();
DROP FUNCTION IF EXISTS public.account_pricing_template_save(integer, jsonb);
DROP FUNCTION IF EXISTS public.tenant_products_unsynced(uuid, text);
DROP FUNCTION IF EXISTS public.get_tenant_usage(uuid);
DROP FUNCTION IF EXISTS public.rotate_api_key(uuid, text);
