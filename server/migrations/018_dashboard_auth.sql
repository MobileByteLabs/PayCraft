-- Migration 018: Dashboard Auth — Tenant Admin Users
-- Links Supabase Auth users to tenants with role-based access.

CREATE TABLE IF NOT EXISTS public.tenant_admins (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    user_id     UUID        NOT NULL,  -- Supabase Auth user ID
    role        TEXT        NOT NULL DEFAULT 'admin'
                CHECK (role IN ('owner', 'admin', 'viewer')),
    invited_by  UUID,                  -- user_id of inviter
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(tenant_id, user_id)
);

-- RLS: users can only see their own tenant memberships
ALTER TABLE public.tenant_admins ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_admins_own"
    ON public.tenant_admins FOR SELECT
    USING (user_id = auth.uid());

CREATE POLICY "tenant_admins_service_role"
    ON public.tenant_admins FOR ALL
    USING (current_setting('role') = 'service_role')
    WITH CHECK (current_setting('role') = 'service_role');

-- Index for fast user → tenant lookup
CREATE INDEX IF NOT EXISTS idx_tenant_admins_user
    ON public.tenant_admins(user_id);

COMMENT ON TABLE public.tenant_admins IS 'PayCraft Dashboard: maps auth users to tenants with roles';
