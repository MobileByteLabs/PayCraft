-- GDPR cascade deletion for a tenant ($1 = tenant_id)
-- tenant_id FK ON DELETE CASCADE handles: tenant_products, tenant_pricing,
-- tenant_paywall, tenant_team_members, tenant_audit_log, registered_devices,
-- api_keys, tenant_stripe_connect, tier_gates

BEGIN;

-- Anonymize subscriptions (retain for 7-year accounting compliance, strip PII)
UPDATE subscriptions
SET email = 'deleted-' || id || '@deleted.invalid',
    metadata = '{}'::jsonb
WHERE tenant_id = $1;

-- Hard-delete auth.users for team members (non-recoverable)
DELETE FROM auth.users
WHERE id IN (
  SELECT user_id FROM tenant_team_members WHERE tenant_id = $1
);

-- Hard-delete the tenant — cascades to all FK-linked tables
DELETE FROM tenants WHERE id = $1;

COMMIT;
