-- 145_auth_attempt_throttle.sql
--
-- A SHARED bucket for failed authentication attempts.
--
-- WHY THE IN-MEMORY VERSION WAS NOT ENOUGH
-- The first attempt at this kept a Map in the Worker module scope. Measured against production: 26
-- consecutive bad keys, 26 × 401, never a 429. Cloudflare spreads requests across isolates, so a
-- per-isolate counter never accumulates — the limiter was decorative, which is worse than absent
-- because it reads like protection in code review.
--
-- The edge is the natural place for this (a WAF rate-limiting rule), but the deploy token has no
-- WAF permission, so that route is closed without a human widening it. This is the enforcement that
-- can actually be shipped from here, and it is genuinely shared: one bucket, every isolate.
--
-- COST, STATED PLAINLY
-- One indexed upsert per REJECTED attempt. Not per request — a successful call never touches this.
-- That is deliberate: the alternative (checking before every request) would double the database
-- calls on the honest path to slow down a path that is already bounded by Cloudflare in front of it.
--
-- WHAT THIS IS AND IS NOT FOR
-- A PayCraft key is 32 bytes of CSPRNG output; brute force is not the threat and no rate limit makes
-- it one. This stops the cheap attacks: replaying a leaked key list at line rate, and using the
-- endpoint as free compute. The entropy is what protects the data.
--
-- The IP is HASHED before it arrives. The server never needs to know who an attacker is, only that
-- the same source is repeating itself, and storing raw addresses would make this table a privacy
-- liability for no operational gain.

CREATE TABLE IF NOT EXISTS auth_attempt_buckets (
  ip_hash     TEXT PRIMARY KEY,
  tokens      NUMERIC     NOT NULL,
  last_refill TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE auth_attempt_buckets IS
  'Token buckets for FAILED API authentication, keyed by a salted hash of the client address. '
  'Written only on rejection. Swept by auth_attempt_buckets_purge.';

ALTER TABLE auth_attempt_buckets ENABLE ROW LEVEL SECURITY;
-- No policy: service_role bypasses RLS and is the only intended caller. An explicit empty policy set
-- means a leaked anon key cannot enumerate who has been failing to authenticate.

CREATE OR REPLACE FUNCTION public.auth_attempt_record(
  p_ip_hash     TEXT,
  p_max_tokens  INT     DEFAULT 20,
  p_refill_per_sec NUMERIC DEFAULT 0.333
)
RETURNS BOOLEAN            -- TRUE = still allowed, FALSE = throttled
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tokens NUMERIC;
  v_last   TIMESTAMPTZ;
  v_new    NUMERIC;
BEGIN
  IF p_ip_hash IS NULL OR length(p_ip_hash) = 0 THEN
    -- No usable source identity (a caller behind something that strips the header). Fail OPEN: the
    -- alternative is a single unattributable request throttling every other caller that shares the
    -- same empty key.
    RETURN TRUE;
  END IF;

  SELECT tokens, last_refill INTO v_tokens, v_last
  FROM auth_attempt_buckets WHERE ip_hash = p_ip_hash FOR UPDATE;

  IF NOT FOUND THEN
    -- First failure from this source: it consumes one token, leaving max-1.
    INSERT INTO auth_attempt_buckets (ip_hash, tokens, last_refill)
    VALUES (p_ip_hash, p_max_tokens - 1, now())
    ON CONFLICT (ip_hash) DO NOTHING;
    RETURN TRUE;
  END IF;

  v_new := LEAST(p_max_tokens, v_tokens + EXTRACT(EPOCH FROM (now() - v_last)) * p_refill_per_sec);

  IF v_new < 1 THEN
    UPDATE auth_attempt_buckets SET tokens = v_new, last_refill = now() WHERE ip_hash = p_ip_hash;
    RETURN FALSE;
  END IF;

  UPDATE auth_attempt_buckets SET tokens = v_new - 1, last_refill = now() WHERE ip_hash = p_ip_hash;
  RETURN TRUE;
END;
$$;

-- Housekeeping: a row whose bucket has fully refilled carries no information.
CREATE OR REPLACE FUNCTION public.auth_attempt_buckets_purge()
RETURNS INT
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH gone AS (
    DELETE FROM auth_attempt_buckets WHERE last_refill < now() - INTERVAL '1 hour' RETURNING 1
  ) SELECT COUNT(*)::INT FROM gone;
$$;

REVOKE ALL ON FUNCTION public.auth_attempt_record(TEXT, INT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_attempt_record(TEXT, INT, NUMERIC) TO service_role;
REVOKE ALL ON FUNCTION public.auth_attempt_buckets_purge() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.auth_attempt_buckets_purge() TO service_role;
