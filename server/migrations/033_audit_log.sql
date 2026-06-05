-- 033_audit_log.sql — Tenant-scoped append-only audit log for SOC2-readiness
BEGIN;

CREATE TABLE IF NOT EXISTS tenant_audit_log (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id     UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_user_id UUID,                              -- NULL when actor is webhook/system
  actor_type    TEXT NOT NULL CHECK (actor_type IN ('user','webhook','system','api_key')),
  action        TEXT NOT NULL,                     -- 'product.created' | 'webhook.processed' | ...
  resource      TEXT NOT NULL,                     -- 'tenant_products:id=<uuid>'
  before_jsonb  JSONB,
  after_jsonb   JSONB,
  ip_address    INET,
  user_agent    TEXT,
  ts            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_audit_log_tenant_ts
  ON tenant_audit_log(tenant_id, ts DESC);
CREATE INDEX IF NOT EXISTS tenant_audit_log_action
  ON tenant_audit_log(tenant_id, action, ts DESC);
CREATE INDEX IF NOT EXISTS tenant_audit_log_actor
  ON tenant_audit_log(actor_user_id) WHERE actor_user_id IS NOT NULL;

ALTER TABLE tenant_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_audit_log_read ON tenant_audit_log;
CREATE POLICY tenant_audit_log_read ON tenant_audit_log FOR SELECT
  USING (tenant_id IN (SELECT ta.tenant_id FROM tenant_admins ta WHERE ta.user_id = auth.uid()));

CREATE OR REPLACE FUNCTION audit_log_emit(
  p_tenant_id     UUID,
  p_actor_user_id UUID,
  p_actor_type    TEXT,
  p_action        TEXT,
  p_resource      TEXT,
  p_before        JSONB DEFAULT NULL,
  p_after         JSONB DEFAULT NULL,
  p_ip            INET DEFAULT NULL,
  p_user_agent    TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE sql SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO tenant_audit_log(
    tenant_id, actor_user_id, actor_type, action, resource,
    before_jsonb, after_jsonb, ip_address, user_agent
  )
  VALUES (
    p_tenant_id, p_actor_user_id, p_actor_type, p_action, p_resource,
    p_before, p_after, p_ip, p_user_agent
  )
  RETURNING id;
$$;

-- Per-tier retention (tunable via tier_definitions.analytics_retention_days).
-- pg_cron job added in migration 037.
CREATE OR REPLACE FUNCTION tenant_audit_log_purge_stale()
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_deleted INT := 0;
  rec RECORD;
BEGIN
  FOR rec IN
    SELECT t.id AS tenant_id, td.analytics_retention_days
      FROM tenants t
      LEFT JOIN tier_definitions td ON td.tier_name = t.plan
  LOOP
    DELETE FROM tenant_audit_log
     WHERE tenant_id = rec.tenant_id
       AND ts < now() - (COALESCE(rec.analytics_retention_days, 7) || ' days')::INTERVAL;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
  END LOOP;
  RETURN v_deleted;
END;
$$;

COMMIT;
