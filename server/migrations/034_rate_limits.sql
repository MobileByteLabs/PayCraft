-- 034_rate_limits.sql — Per-tenant token-bucket rate limits
BEGIN;

CREATE TABLE IF NOT EXISTS tenant_rate_limits (
  tenant_id    UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  bucket_name  TEXT NOT NULL,                      -- 'config_fetch' | 'webhook_inbound' | 'dashboard_mutate'
  tokens       NUMERIC NOT NULL,
  last_refill  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, bucket_name)
);

-- Token-bucket algorithm — atomically consumes 1 token if available.
-- Returns TRUE if request allowed, FALSE if rate-limited.
CREATE OR REPLACE FUNCTION rate_limit_check(
  p_tenant_id      UUID,
  p_bucket_name    TEXT,
  p_max_tokens     INT,
  p_refill_per_sec NUMERIC
)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tokens      NUMERIC;
  v_last_refill TIMESTAMPTZ;
  v_elapsed     NUMERIC;
  v_new_tokens  NUMERIC;
BEGIN
  -- First-time bucket initialization
  SELECT tokens, last_refill INTO v_tokens, v_last_refill
    FROM tenant_rate_limits
   WHERE tenant_id = p_tenant_id AND bucket_name = p_bucket_name
   FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO tenant_rate_limits(tenant_id, bucket_name, tokens, last_refill)
    VALUES (p_tenant_id, p_bucket_name, p_max_tokens - 1, now())
    ON CONFLICT DO NOTHING;
    RETURN true;
  END IF;

  -- Refill since last check
  v_elapsed := EXTRACT(EPOCH FROM (now() - v_last_refill));
  v_new_tokens := LEAST(p_max_tokens::NUMERIC, v_tokens + (v_elapsed * p_refill_per_sec));

  IF v_new_tokens < 1 THEN
    -- Refresh refill timestamp even on reject to keep bucket math consistent.
    UPDATE tenant_rate_limits
       SET tokens = v_new_tokens, last_refill = now()
     WHERE tenant_id = p_tenant_id AND bucket_name = p_bucket_name;
    RETURN false;
  END IF;

  UPDATE tenant_rate_limits
     SET tokens = v_new_tokens - 1, last_refill = now()
   WHERE tenant_id = p_tenant_id AND bucket_name = p_bucket_name;
  RETURN true;
END;
$$;

COMMIT;
