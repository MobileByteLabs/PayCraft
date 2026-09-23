-- 146_request_throttle_per_ip.sql
--
-- A per-SOURCE bucket for ALL API requests, not just failed authentication.
--
-- WHY THE EDGE CANNOT DO THIS (measured, not assumed)
-- The obvious home for per-IP rate limiting is a Cloudflare rate-limiting rule. It does not work
-- here. `api.paycraft` and `mcp.paycraft` are Pages custom domains, and a zone rate-limiting rule
-- pointed at them never fires: with the threshold lowered to its floor (5 requests / 10s), 30
-- concurrent requests all returned 200 and Cloudflare blocked none. Custom FIREWALL rules do reach
-- those hosts — a probe rule blocking one path returned 403 immediately — so the gap is specific to
-- the rate-limiting phase, and custom rules cannot express a rate.
--
-- That leaves the application as the only place a rate limit can actually be enforced for these
-- hostnames on this plan. So it is built here properly rather than assumed to exist upstream.
--
-- WHAT THIS ADDS OVER WHAT EXISTS
--   · tenant_rate_limits  (034) — per TENANT, only reachable once a key has authenticated
--   · auth_attempt_buckets(145) — per SOURCE, only charged when authentication FAILS
--   · this table          (146) — per SOURCE, charged on EVERY request
--
-- The gap it closes: a caller holding one valid key, or hammering a public docs path, was bounded
-- only by their own tenant quota or not at all. Unauthenticated traffic to /v1/openapi.json had no
-- limit of any kind.
--
-- The address is hashed with a secret salt before it arrives, exactly as in 145 — the server needs
-- to know a source is repeating itself, never who it is.

CREATE TABLE IF NOT EXISTS request_throttle_buckets (
  ip_hash     TEXT PRIMARY KEY,
  tokens      NUMERIC     NOT NULL,
  last_refill TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE request_throttle_buckets IS
  'Per-source token buckets for every API request. Distinct from auth_attempt_buckets (145), which '
  'counts only failures. Rows are swept by request_throttle_purge.';

ALTER TABLE request_throttle_buckets ENABLE ROW LEVEL SECURITY;
-- No policy. service_role bypasses RLS and is the only caller; an empty policy set means a leaked
-- anon key cannot enumerate traffic sources.

CREATE OR REPLACE FUNCTION public.request_throttle_check(
  p_ip_hash        TEXT,
  p_max_tokens     INT     DEFAULT 600,
  p_refill_per_sec NUMERIC DEFAULT 10
)
RETURNS BOOLEAN              -- TRUE = allowed, FALSE = throttled
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tokens NUMERIC;
  v_last   TIMESTAMPTZ;
  v_new    NUMERIC;
BEGIN
  -- No usable source identity: fail OPEN. One unattributable request must not be able to throttle
  -- every other caller that also lacks the header.
  IF p_ip_hash IS NULL OR length(p_ip_hash) = 0 THEN RETURN TRUE; END IF;

  SELECT tokens, last_refill INTO v_tokens, v_last
  FROM request_throttle_buckets WHERE ip_hash = p_ip_hash FOR UPDATE;

  IF NOT FOUND THEN
    INSERT INTO request_throttle_buckets (ip_hash, tokens, last_refill)
    VALUES (p_ip_hash, p_max_tokens - 1, now())
    ON CONFLICT (ip_hash) DO NOTHING;
    RETURN TRUE;
  END IF;

  v_new := LEAST(p_max_tokens, v_tokens + EXTRACT(EPOCH FROM (now() - v_last)) * p_refill_per_sec);

  IF v_new < 1 THEN
    UPDATE request_throttle_buckets SET tokens = v_new, last_refill = now() WHERE ip_hash = p_ip_hash;
    RETURN FALSE;
  END IF;

  UPDATE request_throttle_buckets SET tokens = v_new - 1, last_refill = now() WHERE ip_hash = p_ip_hash;
  RETURN TRUE;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_throttle_purge()
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH gone AS (
    DELETE FROM request_throttle_buckets WHERE last_refill < now() - INTERVAL '1 hour' RETURNING 1
  ) SELECT COUNT(*)::INT FROM gone;
$$;

REVOKE ALL ON FUNCTION public.request_throttle_check(TEXT, INT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_throttle_check(TEXT, INT, NUMERIC) TO service_role;
REVOKE ALL ON FUNCTION public.request_throttle_purge() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.request_throttle_purge() TO service_role;
