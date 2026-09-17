-- 064_support_tickets.sql
--
-- Phase 4 of paycraft-v2-production-readiness — support ticket inbox.
--
-- Idempotent (safe to re-apply): every CREATE wrapped in IF NOT EXISTS,
-- every POLICY preceded by DROP POLICY IF EXISTS per CLAUDE.md migration
-- discipline.

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES public.tenants(id) ON DELETE SET NULL,
  email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  source TEXT NOT NULL DEFAULT 'dashboard'
    CHECK (source IN ('dashboard', 'email', 'api')),
  linear_issue_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS support_tickets_status_idx
  ON public.support_tickets(status)
  WHERE status IN ('open', 'in_progress');

CREATE INDEX IF NOT EXISTS support_tickets_tenant_idx
  ON public.support_tickets(tenant_id)
  WHERE tenant_id IS NOT NULL;

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_tickets_service_role ON public.support_tickets;
CREATE POLICY support_tickets_service_role
  ON public.support_tickets
  FOR ALL TO service_role
  USING (true) WITH CHECK (true);

-- Tenant admins may SELECT their own tenant's tickets.
DROP POLICY IF EXISTS support_tickets_tenant_admin_select ON public.support_tickets;
CREATE POLICY support_tickets_tenant_admin_select
  ON public.support_tickets
  FOR SELECT TO authenticated
  USING (
    tenant_id IN (
      SELECT ta.tenant_id FROM public.tenant_admins ta WHERE ta.user_id = auth.uid()
    )
  );

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.support_tickets_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS support_tickets_updated_at_trigger ON public.support_tickets;
CREATE TRIGGER support_tickets_updated_at_trigger
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION public.support_tickets_set_updated_at();
