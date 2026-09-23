-- 144_api_scopes_full_surface.sql
--
-- Widen the management API's scope vocabulary to cover the whole tenant surface.
--
-- 136 deliberately made the scope list a CHECK constraint rather than free text, so an unknown
-- scope is refused at write time instead of silently granting nothing today and something later,
-- when a route starts honouring the string. The cost of that decision is exactly this migration —
-- which is the correct trade: adding a scope is a reviewed schema change, not a typo.
--
-- The new scopes are all READ. The only writes the API exposes remain the two sync operations,
-- because those are the ones automation actually needs; everything else a machine wants from
-- PayCraft is an observation. Adding `*:write` scopes here would mean shipping endpoints nobody
-- asked for, each one a way to corrupt billing state from a script.
--
-- `subscribers:read` covers both subscriptions and entitlement records: they are two views of the
-- same fact (who is entitled to what), and splitting them would invite a key that can see a
-- customer's plan but not whether it is active.

ALTER TABLE tenant_api_keys DROP CONSTRAINT IF EXISTS tenant_api_keys_scopes_known;

ALTER TABLE tenant_api_keys ADD CONSTRAINT tenant_api_keys_scopes_known CHECK (
  scopes <@ ARRAY[
    -- existing
    'providers:read',
    'products:read',
    'products:sync',
    'readiness:read',
    -- added by 144
    'tenant:read',
    'subscribers:read',
    'coupons:read',
    'paywall:read',
    'audit:read',
    'webhooks:read'
  ]::TEXT[]
);

COMMENT ON COLUMN tenant_api_keys.scopes IS
  'Closed vocabulary, enforced by tenant_api_keys_scopes_known. Read scopes grant GET on their '
  'resource; products:sync is the only scope that writes to live payment providers.';
