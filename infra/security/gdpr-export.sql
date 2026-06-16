-- GDPR data export for a tenant_admin user ($1 = user_id, $2 = tenant_id)
-- Returns all data associated with the tenant as a JSON blob.

SELECT json_build_object(
  'tenant', (SELECT row_to_json(t) FROM tenants t WHERE t.id = $2),
  'products', (SELECT json_agg(row_to_json(p)) FROM tenant_products p WHERE p.tenant_id = $2),
  'subscriptions', (SELECT json_agg(row_to_json(s)) FROM subscriptions s WHERE s.tenant_id = $2),
  'devices', (SELECT json_agg(row_to_json(d)) FROM registered_devices d
              WHERE d.tenant_id = $2),
  'audit_log', (SELECT json_agg(row_to_json(a)) FROM tenant_audit_log a
                WHERE a.tenant_id = $2
                ORDER BY a.created_at DESC
                LIMIT 10000),
  'team_members', (SELECT json_agg(row_to_json(m)) FROM tenant_team_members m
                   WHERE m.tenant_id = $2)
) AS export_data;
