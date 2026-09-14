-- 110_providers_resolved_list.sql
--
-- Report what an app RESOLVES to, for every provider at once.
--
-- The providers index answers "is this connected?" with `tenant_providers.has(provider)` — the
-- existence of a ROW. That was the right question before 103, when a credential could only live on
-- the app's own row. It is the wrong question now: an app with no row at all still resolves to the
-- account default and bills perfectly well, so a freshly-created app showed "Set up" on every card
-- while `tenant_provider_resolve` on the detail page said `connected: true`. That is exactly the
-- reported symptom — connected only after clicking Manage — and it is a reporting bug, not a
-- connection bug. Verified against production: a tenant with zero `tenant_providers` rows whose
-- admin owns a default connection resolves `connected: true, via_default: true`.
--
-- One call for all providers rather than N round trips, because the index renders every card at
-- once and per-card resolution would be a query per provider per page load.
--
-- `tenant_provider_resolve` (103/105) stays the single-provider detail answer; this is the same
-- resolution rule applied across the set. The rule lives in one place — a plpgsql loop calling that
-- function — so the list and the detail view cannot drift into disagreeing about what is connected,
-- which is the failure this migration exists to end.

CREATE OR REPLACE FUNCTION public.tenant_providers_resolved_list(p_tenant_id UUID)
RETURNS TABLE (
  provider     TEXT,
  connected    BOOLEAN,
  via_default  BOOLEAN,
  account_id   UUID,
  label        TEXT
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_provider TEXT;
  v_res      JSONB;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant_id AND user_id = auth.uid()
  ) THEN RAISE EXCEPTION 'forbidden'; END IF;

  -- The provider vocabulary comes from the registry plus whatever rows the app already has, so a
  -- provider this app configured but the registry has not yet listed is still reported rather than
  -- silently dropped.
  FOR v_provider IN
    SELECT DISTINCT p FROM (
      SELECT DISTINCT pmr.provider AS p FROM provider_method_registry pmr
      UNION
      SELECT DISTINCT tp.provider    FROM tenant_providers tp WHERE tp.tenant_id = p_tenant_id
      UNION
      -- Providers the ACCOUNT has connections for: an app that has never touched Play still has a
      -- Play connection available to it through the default, and the index must say so.
      SELECT DISTINCT pa.provider FROM provider_accounts pa
      WHERE pa.owner_user_id IN (SELECT user_id FROM tenant_admins WHERE tenant_id = p_tenant_id)
    ) x WHERE p IS NOT NULL
  LOOP
    v_res := tenant_provider_resolve(p_tenant_id, v_provider);
    provider    := v_provider;
    connected   := COALESCE((v_res->>'connected')::BOOLEAN, false);
    via_default := COALESCE((v_res->>'via_default')::BOOLEAN, false);
    account_id  := NULLIF(v_res->>'account_id','')::UUID;
    label       := v_res->>'label';
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.tenant_providers_resolved_list(UUID) IS
  'Resolved connectivity per provider for one app (pinned account → account default → app-local). The list-view twin of tenant_provider_resolve; the index must not infer connectivity from row existence.';

REVOKE ALL ON FUNCTION public.tenant_providers_resolved_list(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.tenant_providers_resolved_list(UUID) TO authenticated, service_role;
