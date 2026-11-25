-- 216 — analytics_findings (paycraft-ga4-analytics-audit sub-plan 04).
--
-- What Claude found about an app's users: the weekly `attempt-insights` digest and `/idea-paycraft-analytics` write
-- here, the Analytics page's AI audit panel reads it, and the command drains the open ones by fixing them at their
-- source and resolving them with what was done.
--   * one row per (tenant, kind, window) — a re-run refreshes it rather than duplicating it
--   * status open → fixed | dismissed, with a note and a time; a resolved finding is not reopened by a re-run
--   * aggregates only: `evidence` holds counts and codes, never a buyer
--
-- Idempotent: CREATE … IF NOT EXISTS, CREATE OR REPLACE, DROP POLICY IF EXISTS.

CREATE TABLE IF NOT EXISTS public.analytics_findings (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  kind         TEXT        NOT NULL CHECK (kind ~ '^[a-z0-9_]{1,64}$'),
  severity     TEXT        NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  title        TEXT        NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  summary      TEXT        CHECK (length(summary) <= 2000),
  evidence     JSONB       NOT NULL DEFAULT '{}'::jsonb,
  proposed_fix TEXT        CHECK (length(proposed_fix) <= 2000),
  source       TEXT        NOT NULL CHECK (source IN ('digest', 'command')),
  window_start DATE        NOT NULL,
  window_end   DATE        NOT NULL,
  status       TEXT        NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'fixed', 'dismissed')),
  fixed_note   TEXT        CHECK (length(fixed_note) <= 2000),
  fixed_at     TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, kind, window_start)
);
CREATE INDEX IF NOT EXISTS analytics_findings_tenant_status_idx ON public.analytics_findings (tenant_id, status, created_at DESC);

ALTER TABLE public.analytics_findings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS analytics_findings_admin_read ON public.analytics_findings;
CREATE POLICY analytics_findings_admin_read ON public.analytics_findings FOR SELECT TO authenticated
  USING (tenant_id IN (SELECT ta.tenant_id FROM public.tenant_admins ta WHERE ta.user_id = auth.uid()));
-- Writes: service_role only (the digest, the API the command calls) — through the two functions below.
REVOKE ALL ON public.analytics_findings FROM anon, authenticated;
GRANT SELECT ON public.analytics_findings TO authenticated;

-- Record a finding, or refresh the open one for the same (tenant, kind, window). A fixed / dismissed finding keeps
-- its resolution: the same evidence arriving again does not reopen what was already handled.
CREATE OR REPLACE FUNCTION public.analytics_finding_upsert(
  p_tenant_id UUID, p_kind TEXT, p_severity TEXT, p_title TEXT, p_summary TEXT, p_evidence JSONB,
  p_proposed_fix TEXT, p_source TEXT, p_window_start DATE, p_window_end DATE
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id UUID;
BEGIN
  INSERT INTO analytics_findings (tenant_id, kind, severity, title, summary, evidence, proposed_fix, source,
                                  window_start, window_end)
  VALUES (p_tenant_id, p_kind, p_severity, left(p_title, 200), left(p_summary, 2000), COALESCE(p_evidence, '{}'::jsonb),
          left(p_proposed_fix, 2000), p_source, p_window_start, p_window_end)
  ON CONFLICT (tenant_id, kind, window_start) DO UPDATE
     SET severity = EXCLUDED.severity, title = EXCLUDED.title, summary = EXCLUDED.summary,
         evidence = EXCLUDED.evidence, proposed_fix = EXCLUDED.proposed_fix, source = EXCLUDED.source,
         window_end = EXCLUDED.window_end, updated_at = now()
   WHERE analytics_findings.status = 'open'
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN  -- the existing row is resolved: leave it as it is
    SELECT id INTO v_id FROM analytics_findings
     WHERE tenant_id = p_tenant_id AND kind = p_kind AND window_start = p_window_start;
  END IF;
  RETURN v_id;
END; $$;

-- Mark a finding fixed or dismissed, with what was done.
CREATE OR REPLACE FUNCTION public.analytics_finding_resolve(p_id UUID, p_status TEXT, p_note TEXT)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_status NOT IN ('fixed', 'dismissed', 'open') THEN
    RAISE EXCEPTION 'analytics_finding_resolve: status must be fixed, dismissed or open' USING ERRCODE = '22023';
  END IF;
  UPDATE analytics_findings
     SET status = p_status, fixed_note = left(p_note, 2000),
         fixed_at = CASE WHEN p_status = 'open' THEN NULL ELSE now() END, updated_at = now()
   WHERE id = p_id;
END; $$;

REVOKE ALL ON FUNCTION public.analytics_finding_upsert(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, DATE, DATE) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.analytics_finding_resolve(UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.analytics_finding_upsert(UUID, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT, TEXT, DATE, DATE) TO service_role;
GRANT EXECUTE ON FUNCTION public.analytics_finding_resolve(UUID, TEXT, TEXT) TO service_role;
