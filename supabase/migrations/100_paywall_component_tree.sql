-- 100_paywall_component_tree.sql
--
-- Epic 2 (paycraft-render-component-tree) Phase 1 — the server half of the server-driven paywall.
--
-- WHAT THIS ADDS
--   A paywall stops being ~25 flat columns and becomes a COMPONENT TREE the SDK renders generically.
--   The flat columns stay exactly as they are: D7 makes the tree an additive nullable field and the
--   SDK renders tree-else-template, so every already-deployed SDK keeps working with no coordinated
--   rollout. Nothing here is destructive.
--
-- WHY ONE `workflow` COLUMN AND NOT FIVE
--   The audited reference (RevenueCat, 2026-09-13) splits a paywall across components_config,
--   components_localizations, state_declarations and a published_* twin of each. That shape makes
--   publishing a multi-column copy that can tear: a crash between two UPDATEs leaves published text
--   pointing at lids that only exist in the draft. Holding the whole authored artifact in ONE jsonb
--   makes publish a single assignment — atomic by construction.
--
--   workflow := {
--     "schema_version": 2,
--     "initial_step_id": "<step id>",
--     "steps": [ { "id", "name", "node_position": {"x","y"}, "is_last_step",
--                  "components_config": <node tree> } ],
--     "localizations": { "en_US": { "<lid>": "<string>" } }
--   }
--
-- D13 — components never hold literal text. A text node carries `text_lid` into
-- `localizations[locale]`. This is the precondition for "update from existing template": re-applying
-- a template replaces the TREE while the tenant's authored strings survive, because they live in a
-- separate keyed table rather than inline in the nodes being replaced.
--
-- D14 — any node may carry `overrides: [{ conditions: [...], properties: {...} }]`, so trial-vs-
-- regular copy and selected-package styling are data instead of renderer branches.
--
-- D15 — `steps` is always an array; a single-screen paywall is simply one step. There is no
-- single-screen special case to keep in sync with a multi-screen one.

-- ── 1. Columns — draft + published twin ─────────────────────────────────────────────────────────
ALTER TABLE public.tenant_paywall
  ADD COLUMN IF NOT EXISTS schema_version     INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS workflow           JSONB,
  ADD COLUMN IF NOT EXISTS published_workflow JSONB,
  ADD COLUMN IF NOT EXISTS revision           INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS published_revision INT,
  ADD COLUMN IF NOT EXISTS published_at       TIMESTAMPTZ;

COMMENT ON COLUMN public.tenant_paywall.workflow IS
  'DRAFT component tree. Authored by the dashboard; never read by the SDK.';
COMMENT ON COLUMN public.tenant_paywall.published_workflow IS
  'PUBLISHED component tree — the ONLY paywall tree /config serves. Editing a draft can never change a live paywall.';
COMMENT ON COLUMN public.tenant_paywall.schema_version IS
  'Renderer contract version. 1 = legacy flat columns (hex/Int styling). 2 = component tree. D11 keeps both renderable.';

-- ── 2. Validator (D9) ───────────────────────────────────────────────────────────────────────────
-- IMMUTABLE + invoked from the upsert, exactly as sanitize_paywall_svg() established in 071: a
-- dashboard-authored, client-rendered payload is untrusted input.
--
-- AC-12 is "server rejects a malformed tree", and the failure it guards against is specific: an
-- unknown node type reaching a released SDK. AC-5 says an older SDK must DEGRADE rather than crash,
-- so the renderer substitutes unknown nodes — which means a typo'd type would otherwise render as a
-- silent blank box with no error anywhere. Rejecting at write time is the only place it is visible.
CREATE OR REPLACE FUNCTION public.validate_paywall_workflow(p_workflow JSONB)
RETURNS JSONB
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_steps        JSONB;
  v_step         JSONB;
  v_initial      TEXT;
  v_ids          TEXT[] := ARRAY[]::TEXT[];
  v_version      INT;
  -- The renderer's vocabulary. A type outside this set cannot be rendered by ANY SDK build.
  v_known_types  TEXT[] := ARRAY[
    'stack','text','image','icon','button','package','purchase_button',
    'restore_purchases','footer','timeline','timeline_item','zlayer','pill','badge','spacer','carousel'
  ];
  v_found        TEXT;
BEGIN
  IF p_workflow IS NULL THEN
    RETURN NULL;                               -- no tree = legacy template path (D7)
  END IF;

  -- AC-6: schema_version present and enforced. Absent is rejected rather than defaulted, because a
  -- tree with no declared contract is exactly what an older SDK cannot reason about.
  v_version := (p_workflow->>'schema_version')::INT;
  IF v_version IS NULL THEN
    RAISE EXCEPTION 'workflow.schema_version is required' USING ERRCODE = 'check_violation';
  END IF;
  IF v_version NOT BETWEEN 1 AND 2 THEN
    RAISE EXCEPTION 'workflow.schema_version % is not supported (expected 1..2)', v_version
      USING ERRCODE = 'check_violation';
  END IF;

  v_steps := p_workflow->'steps';
  IF v_steps IS NULL OR jsonb_typeof(v_steps) <> 'array' OR jsonb_array_length(v_steps) = 0 THEN
    RAISE EXCEPTION 'workflow.steps must be a non-empty array' USING ERRCODE = 'check_violation';
  END IF;

  FOR v_step IN SELECT * FROM jsonb_array_elements(v_steps) LOOP
    IF COALESCE(v_step->>'id', '') = '' THEN
      RAISE EXCEPTION 'every workflow step requires a non-empty id' USING ERRCODE = 'check_violation';
    END IF;
    IF v_step->'components_config' IS NULL THEN
      RAISE EXCEPTION 'step % has no components_config', v_step->>'id' USING ERRCODE = 'check_violation';
    END IF;
    v_ids := v_ids || (v_step->>'id');
  END LOOP;

  -- D15: a dangling initial_step_id means the SDK opens a paywall that renders nothing at all.
  v_initial := p_workflow->>'initial_step_id';
  IF v_initial IS NULL OR NOT (v_initial = ANY(v_ids)) THEN
    RAISE EXCEPTION 'workflow.initial_step_id % does not match any step id', COALESCE(v_initial, '<null>')
      USING ERRCODE = 'check_violation';
  END IF;

  -- Unknown node type anywhere in any tree. jsonb_path_query finds every "type" at any depth; we
  -- only police the ones in a components position, so palette values like "hex" never trip it.
  SELECT t INTO v_found
  FROM jsonb_path_query(p_workflow, '$.steps[*].components_config.**.components[*].type') AS t
  WHERE trim(both '"' from t::text) <> ALL(v_known_types)
  LIMIT 1;
  IF v_found IS NOT NULL THEN
    RAISE EXCEPTION 'unknown component type % — no SDK build can render it', v_found
      USING ERRCODE = 'check_violation';
  END IF;

  -- Same spirit as sanitize_paywall_svg: this payload is rendered on a client.
  IF p_workflow::text ~* '<\s*script\y' THEN
    RAISE EXCEPTION 'workflow contains <script> — forbidden' USING ERRCODE = 'check_violation';
  END IF;

  RETURN p_workflow;
END;
$$;

COMMENT ON FUNCTION public.validate_paywall_workflow(JSONB) IS
  'Validates a paywall component-tree workflow: schema_version, non-empty steps, resolvable initial_step_id, known node types, no <script>. Invoked by tenant_paywall_workflow_upsert. AC-6 + AC-12.';

-- ── 3. Draft write — validates, then bumps revision ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_paywall_workflow_upsert(p_tenant UUID, p_workflow JSONB)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_revision INT;
BEGIN
  IF p_tenant IS NULL THEN
    RAISE EXCEPTION 'tenant_id required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  PERFORM public.validate_paywall_workflow(p_workflow);

  INSERT INTO tenant_paywall (tenant_id, workflow, schema_version, revision, updated_at)
  VALUES (p_tenant, p_workflow, COALESCE((p_workflow->>'schema_version')::INT, 2), 1, now())
  ON CONFLICT (tenant_id) DO UPDATE
    SET workflow       = EXCLUDED.workflow,
        schema_version = EXCLUDED.schema_version,
        revision       = tenant_paywall.revision + 1,
        updated_at     = now()
  RETURNING revision INTO v_revision;

  RETURN v_revision;
END;
$$;

COMMENT ON FUNCTION public.tenant_paywall_workflow_upsert(UUID, JSONB) IS
  'Writes the DRAFT paywall tree and returns the new revision. Validates first; never touches published_workflow.';

-- ── 4. Publish — the single atomic assignment ──────────────────────────────────────────────────
-- Re-validates rather than trusting the stored draft: the draft could predate a tightening of the
-- validator, and publishing is the moment a tree becomes reachable by real customers.
CREATE OR REPLACE FUNCTION public.tenant_paywall_publish(p_tenant UUID)
RETURNS INT
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_draft    JSONB;
  v_revision INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT workflow, revision INTO v_draft, v_revision
  FROM tenant_paywall WHERE tenant_id = p_tenant;

  IF v_draft IS NULL THEN
    RAISE EXCEPTION 'nothing to publish — tenant % has no draft workflow', p_tenant
      USING ERRCODE = 'check_violation';
  END IF;

  PERFORM public.validate_paywall_workflow(v_draft);

  UPDATE tenant_paywall
     SET published_workflow = v_draft,
         published_revision = v_revision,
         published_at       = now(),
         updated_at         = now()
   WHERE tenant_id = p_tenant;

  RETURN v_revision;
END;
$$;

COMMENT ON FUNCTION public.tenant_paywall_publish(UUID) IS
  'Copies the draft tree to published_workflow and pins published_revision. The SDK reads published_workflow only, so drafting is always safe.';

REVOKE ALL ON FUNCTION public.tenant_paywall_workflow_upsert(UUID, JSONB) FROM anon;
REVOKE ALL ON FUNCTION public.tenant_paywall_publish(UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.tenant_paywall_workflow_upsert(UUID, JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tenant_paywall_publish(UUID) TO authenticated;
