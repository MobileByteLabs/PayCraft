-- 173_api_paywall_onboarding_write_path.sql — the API/MCP can do what the onboarding runtime needs.
--
-- The /idea-paycraft runtime treats the MCP server (pcsk_ bearer key → /api/v1/*) as its only
-- sanctioned write path, yet applying a paywall template, saving/publishing the draft workflow,
-- editing paywall copy and reading/writing onboarding state existed only behind a cookie session.
-- Every onboarding therefore needed a hand-rolled browser session — the path the API replaced.
--
-- Two changes, both required for the new /api/v1 routes to work at all:
--
-- 1. SCOPES. `onboarding:read` / `onboarding:write` join the closed vocabulary. Separate from
--    paywall/products so a reporting token cannot rewrite the onboarding SoT. `apps:write` is also
--    added: `ApiScope`, the token UI and POST /v1/apps (paycraft_create_app) have demanded it since
--    150, but the constraint never listed it, so no key could ever be minted carrying it.
--    The list is the LIVE set (read back from pg_constraint, per 150's warning) plus these three.
--    If production holds a scope not listed, the ADD fails and the transaction rolls back — it can
--    never silently narrow.
--
-- 2. SERVICE ROLE ON THE FOUR PAYWALL WRITE RPCs. The v1 routes run on the service-role client
--    (the tenant is already resolved and authorized by requireApiKey), where auth.uid() is NULL —
--    so the `auth.uid() IN tenant_admins` guard refused every call. Same widening 139 applied to the
--    sync path, same reasoning: service_role already bypasses RLS on tenant_paywall. The
--    `authenticated` branch is untouched: a signed-in non-admin is still refused.
--
--    Done by rewriting ONLY the guard line of the CURRENT definition rather than restating each
--    body: restating 120 lines of tenant_paywall_upsert from a file is how a later column gets
--    silently dropped (171 exists because 158 did exactly that). Each rewrite asserts it matched
--    exactly once and is skipped when already applied.
--
-- Idempotent.

-- ── 1. scopes ─────────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tenant_api_keys_scopes_known') THEN
    ALTER TABLE tenant_api_keys DROP CONSTRAINT tenant_api_keys_scopes_known;
  END IF;
  ALTER TABLE tenant_api_keys ADD CONSTRAINT tenant_api_keys_scopes_known CHECK (
    scopes <@ ARRAY[
      -- live set as of 150
      'providers:read', 'products:read', 'products:sync', 'readiness:read', 'tenant:read',
      'subscribers:read', 'coupons:read', 'paywall:read', 'audit:read', 'webhooks:read',
      'products:write', 'paywall:write', 'providers:write', 'apps:read', 'apps:provision',
      'keys:rotate',
      -- added by 173
      'apps:write', 'onboarding:read', 'onboarding:write'
    ]::TEXT[]
  );
END $$;

-- ── 2. service_role on the paywall write RPCs ────────────────────────────────────────────────
DO $$
DECLARE
  fn    TEXT;
  def   TEXT;
  guard CONSTANT TEXT := E'IF NOT EXISTS (\n    SELECT 1 FROM tenant_admins';
  hits  INT;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.tenant_paywall_upsert(jsonb)',
    'public.tenant_paywall_workflow_upsert(uuid,jsonb)',
    'public.tenant_paywall_publish(uuid)',
    'public.tenant_paywall_apply_template(uuid,text,text)'
  ] LOOP
    def := pg_get_functiondef(fn::regprocedure);
    CONTINUE WHEN position('service_role' IN def) > 0;  -- already widened
    hits := (length(def) - length(replace(def, guard, ''))) / length(guard);
    IF hits <> 1 THEN
      RAISE EXCEPTION '173: expected exactly one admin guard in %, found %', fn, hits;
    END IF;
    EXECUTE replace(def, guard,
      E'IF auth.role() IS DISTINCT FROM ''service_role'' AND NOT EXISTS (\n    SELECT 1 FROM tenant_admins');
  END LOOP;
END $$;
