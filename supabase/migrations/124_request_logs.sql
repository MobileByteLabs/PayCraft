-- 124_request_logs.sql
--
-- A server-side request log, because this system has repeatedly been debugged by inference.
--
-- WHY IT IS NEEDED, from actual sessions
-- Every stall today needed a DB query or a device logcat to explain, and two of them were explained
-- WRONG at first because the only evidence was after-the-fact state:
--   · "Synced 3 item(s)" was reported for three products whose every razorpay push was skipped —
--     the count came from the loop, not from the outcome.
--   · `SYNC FAILED` badges were read as a live failure when the verdict predated the fix by 3m17s.
--     Nothing recorded WHEN a sync ran, so recency had to be reconstructed from updated_at.
-- `sync_events` already records per-provider phases, but only when a caller passes `runId` — and no
-- drain did, so the table held nothing for any of these runs. A log that exists but is not written
-- is indistinguishable from no log at all.
--
-- WHAT THIS ADDS that sync_events does not
-- sync_events is per (product × provider) inside a sync. This is per REQUEST: which route, by whom,
-- for which tenant, how long, what came back, and the request's own correlation id — so a sync's
-- provider events can be joined to the request that caused them via run_id.
--
-- NO SECRETS: `params` and `result` are for ids, counts, statuses and error MESSAGES. Never a key,
-- token, credential or payment-link URL (RULE-SECRETS-NO-VALUE-EGRESS-001). The redaction is the
-- caller's job because only the caller knows which of its fields are sensitive; `log_request` does
-- not guess.

CREATE TABLE IF NOT EXISTS public.request_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  -- Correlates a request with the sync_events rows it produced.
  run_id      text,
  route       text        NOT NULL,
  method      text        NOT NULL,
  tenant_id   uuid,
  user_id     uuid,
  status      integer,
  duration_ms integer,
  -- Inputs that matter for reproducing the call (ids, counts, flags) — redacted by the caller.
  params      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  -- Outcome the caller reported: counts, per-provider verdicts, error text.
  result      jsonb       NOT NULL DEFAULT '{}'::jsonb,
  error       text
);

CREATE INDEX IF NOT EXISTS request_logs_created_idx ON public.request_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS request_logs_tenant_idx  ON public.request_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS request_logs_run_idx     ON public.request_logs (run_id);

COMMENT ON TABLE public.request_logs IS
  'Per-request server log: route, actor, tenant, status, duration, redacted params + result. '
  'Join to sync_events on run_id to see the provider-level detail of a sync request.';

ALTER TABLE public.request_logs ENABLE ROW LEVEL SECURITY;

-- A tenant admin may read their OWN tenant''s requests; nobody may read another tenant''s.
DROP POLICY IF EXISTS request_logs_read_own_tenant ON public.request_logs;
CREATE POLICY request_logs_read_own_tenant ON public.request_logs
  FOR SELECT TO authenticated
  USING (
    tenant_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM tenant_admins ta WHERE ta.tenant_id = request_logs.tenant_id AND ta.user_id = auth.uid())
  );

-- Writes go through the function below, never direct INSERT — so the shape stays consistent and a
-- caller cannot invent columns or bypass the redaction contract.
REVOKE INSERT, UPDATE, DELETE ON public.request_logs FROM authenticated, anon;

CREATE OR REPLACE FUNCTION public.log_request(
  p_route       text,
  p_method      text,
  p_tenant_id   uuid    DEFAULT NULL,
  p_status      integer DEFAULT NULL,
  p_duration_ms integer DEFAULT NULL,
  p_params      jsonb   DEFAULT '{}'::jsonb,
  p_result      jsonb   DEFAULT '{}'::jsonb,
  p_error       text    DEFAULT NULL,
  p_run_id      text    DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_id uuid;
BEGIN
  -- Deliberately NOT gated on tenant_admins: a request that FAILED auth is exactly the one worth
  -- logging, and requiring membership to log would drop those. user_id/tenant_id may be null.
  INSERT INTO request_logs (run_id, route, method, tenant_id, user_id, status, duration_ms, params, result, error)
  VALUES (p_run_id, p_route, p_method, p_tenant_id, auth.uid(), p_status, p_duration_ms,
          coalesce(p_params,'{}'::jsonb), coalesce(p_result,'{}'::jsonb), p_error)
  RETURNING id INTO v_id;
  RETURN v_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.log_request(text,text,uuid,integer,integer,jsonb,jsonb,text,text) FROM anon, PUBLIC;
GRANT  EXECUTE ON FUNCTION public.log_request(text,text,uuid,integer,integer,jsonb,jsonb,text,text) TO authenticated, service_role;

COMMENT ON FUNCTION public.log_request(text,text,uuid,integer,integer,jsonb,jsonb,text,text) IS
  'Append one request_logs row. Callers MUST pass already-redacted params/result — no keys, tokens '
  'or payment-link URLs. Not membership-gated: a failed-auth request is the one most worth logging.';
