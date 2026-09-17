-- 102_paywall_template_gallery.sql
--
-- Epic 2 Phase 4 — the template gallery, and "apply a template to my paywall".
--
-- WHY A TABLE AND NOT FILES
--   The four trees ship in the SDK's composeResources today, where NOTHING reads them: the SDK
--   renders whatever tree the tenant published, and a tenant with no tree falls back to the Kotlin
--   templates (D7). A gallery is a thing the DASHBOARD offers and the SERVER owns — putting it in
--   the app binary would mean a tenant could only get a new template by shipping an app update,
--   which is the exact coupling this epic exists to remove.
--
-- WHY APPLYING A TEMPLATE WRITES THE DRAFT, NEVER THE PUBLISHED TREE
--   Choosing a template is an editing action. If it wrote published_workflow, browsing the gallery
--   would change what live customers see mid-click, with no review step. So apply == "load this into
--   my draft"; tenant_paywall_publish stays the only thing that reaches a device.
--
-- WHY `update` MODE MERGES LOCALIZATIONS INSTEAD OF REPLACING THEM
--   This is what D13's text_lid indirection was FOR. A tenant who rewrote "Upgrade to Premium" into
--   their own voice, and translated it into three languages, must not lose that by taking a newer
--   version of the layout. So structure comes from the template; copy stays the tenant's wherever a
--   lid still exists; new lids arrive with the template's wording as a starting point.

-- ── 1. The gallery ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.paywall_templates (
  slug           TEXT PRIMARY KEY,
  name           TEXT        NOT NULL,
  description    TEXT,
  category       TEXT        NOT NULL DEFAULT 'general',
  sort_order     INT         NOT NULL DEFAULT 100,
  is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
  schema_version INT         NOT NULL DEFAULT 2,
  workflow       JSONB       NOT NULL,
  preview_url    TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.paywall_templates IS
  'Global paywall template gallery (not tenant-scoped). Rows are seeded by migration; tenants read.';

-- A gallery row is a tree like any other, so it faces the same validator a tenant draft does. A
-- malformed row would otherwise sit in the gallery until someone applied it, turning a seeding
-- mistake into a tenant-visible failure at the least convenient moment.
CREATE OR REPLACE FUNCTION public.paywall_templates_validate()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM public.validate_paywall_workflow(NEW.workflow);
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS paywall_templates_validate_trg ON public.paywall_templates;
CREATE TRIGGER paywall_templates_validate_trg
  BEFORE INSERT OR UPDATE ON public.paywall_templates
  FOR EACH ROW EXECUTE FUNCTION public.paywall_templates_validate();

ALTER TABLE public.paywall_templates ENABLE ROW LEVEL SECURITY;

-- Readable by any signed-in dashboard user; there is nothing tenant-private in a global template.
-- No INSERT/UPDATE/DELETE policy exists on purpose: seeding runs as the migration owner, which
-- bypasses RLS, so no client role can edit the gallery even by accident.
DROP POLICY IF EXISTS paywall_templates_read ON public.paywall_templates;
CREATE POLICY paywall_templates_read ON public.paywall_templates
  FOR SELECT TO authenticated USING (is_active);

-- ── 2. Seed rows ───────────────────────────────────────────────────────────────────────────────
-- Generated from cmp-paycraft/src/commonMain/composeResources/files/paycraft/seed/*.json; the
-- Kotlin test `seed_files_match_the_gallery_migration` fails if the two ever disagree, so this
-- block is never hand-edited. ON CONFLICT DO UPDATE so re-running the migration re-seeds cleanly.
INSERT INTO public.paywall_templates
  (slug, name, description, category, sort_order, schema_version, workflow)
VALUES
  ('branded-stack', 'Branded Stack', 'Hero icon, value props and a dominant CTA. The default for a first paywall.', 'featured', 10, 2,
   '{"initial_step_id":"paywall","localizations":{"en_US":{"annual_name":"Annual","annual_note":"Best value","cta_continue":"Continue","hero_subtitle":"Enjoy ad-free experience, HD downloads, and exclusive features","hero_title":"Upgrade to Premium","monthly_name":"Monthly","monthly_note":"Billed monthly","restore_label":"Restore Your Premium","v_per_period":"{{ product.price_per_period }}","v_price":"{{ product.price }}","v_savings":"{{ product.offer_savings_label }}"}},"schema_version":2,"steps":[{"components_config":{"components":[{"icon_name":"star","size":72,"type":"icon"},{"size":4,"type":"spacer"},{"font_size":26,"font_weight_int":700,"horizontal_alignment":"center","text_lid":"hero_title","type":"text"},{"font_size":14,"horizontal_alignment":"center","text_lid":"hero_subtitle","type":"text"},{"size":8,"type":"spacer"},{"is_selected_by_default":true,"package_id":"$rc_annual","stack":{"components":[{"components":[{"font_size":16,"font_weight_int":600,"text_lid":"annual_name","type":"text"},{"grow":true,"size":0,"type":"spacer"},{"background":{"value":{"light":{"type":"hex","value":"accent"}}},"components":[{"color":{"light":{"type":"hex","value":"on_accent"}},"font_size":11,"font_weight_int":700,"text_lid":"v_savings","type":"text"}],"dimension":"horizontal","padding":{"bottom":3,"leading":8,"top":3,"trailing":8},"shape":{"radius":6},"spacing":0,"type":"stack"},{"font_size":16,"font_weight_int":700,"text_lid":"v_price","type":"text"}],"dimension":"horizontal","spacing":8,"type":"stack"},{"font_size":12,"text_lid":"v_per_period","type":"text"},{"font_size":13,"text_lid":"annual_note","type":"text"}],"dimension":"vertical","overrides":[{"conditions":[{"type":"selected"}],"properties":{"background":"accent_soft","border":"accent","border_width":"2"}}],"padding":{"bottom":14,"leading":16,"top":14,"trailing":16},"shape":{"radius":14},"spacing":2,"type":"stack"},"type":"package"},{"package_id":"$rc_monthly","stack":{"components":[{"components":[{"font_size":16,"font_weight_int":600,"text_lid":"monthly_name","type":"text"},{"grow":true,"size":0,"type":"spacer"},{"background":{"value":{"light":{"type":"hex","value":"accent"}}},"components":[{"color":{"light":{"type":"hex","value":"on_accent"}},"font_size":11,"font_weight_int":700,"text_lid":"v_savings","type":"text"}],"dimension":"horizontal","padding":{"bottom":3,"leading":8,"top":3,"trailing":8},"shape":{"radius":6},"spacing":0,"type":"stack"},{"font_size":16,"font_weight_int":700,"text_lid":"v_price","type":"text"}],"dimension":"horizontal","spacing":8,"type":"stack"},{"font_size":12,"text_lid":"v_per_period","type":"text"},{"font_size":13,"text_lid":"monthly_note","type":"text"}],"dimension":"vertical","overrides":[{"conditions":[{"type":"selected"}],"properties":{"background":"accent_soft","border":"accent","border_width":"2"}}],"padding":{"bottom":14,"leading":16,"top":14,"trailing":16},"shape":{"radius":14},"spacing":2,"type":"stack"},"type":"package"},{"text_lid":"cta_continue","type":"purchase_button"},{"text_lid":"restore_label","type":"restore_purchases"}],"dimension":"vertical","horizontal_alignment":"center","padding":{"bottom":24,"leading":20,"top":24,"trailing":20},"spacing":16,"type":"stack"},"id":"paywall","is_last_step":true,"name":"Paywall screen"}]}'::jsonb),
  ('premium', 'Premium', 'Adds a subtitle under the headline and leads with the annual plan.', 'featured', 20, 2,
   '{"initial_step_id":"paywall","localizations":{"en_US":{"annual":"Annual","cta_continue":"Continue","monthly":"Monthly","restore_label":"Restore Purchases","subtitle":"Unlock everything PayCraft has to offer.","title":"Upgrade to Premium","v_per_period":"{{ product.price_per_period }}","v_price":"{{ product.price }}","v_savings":"{{ product.offer_savings_label }}"}},"schema_version":2,"steps":[{"components_config":{"components":[{"font_size":32,"font_weight_int":800,"text_lid":"title","type":"text"},{"font_size":16,"text_lid":"subtitle","type":"text"},{"is_selected_by_default":true,"package_id":"$rc_annual","stack":{"components":[{"components":[{"font_size":16,"font_weight_int":600,"text_lid":"annual","type":"text"},{"grow":true,"size":0,"type":"spacer"},{"background":{"value":{"light":{"type":"hex","value":"accent"}}},"components":[{"color":{"light":{"type":"hex","value":"on_accent"}},"font_size":11,"font_weight_int":700,"text_lid":"v_savings","type":"text"}],"dimension":"horizontal","padding":{"bottom":3,"leading":8,"top":3,"trailing":8},"shape":{"radius":6},"spacing":0,"type":"stack"},{"font_size":16,"font_weight_int":700,"text_lid":"v_price","type":"text"}],"dimension":"horizontal","spacing":8,"type":"stack"},{"font_size":12,"text_lid":"v_per_period","type":"text"}],"dimension":"vertical","overrides":[{"conditions":[{"type":"selected"}],"properties":{"background":"accent_soft","border":"accent","border_width":"2"}}],"padding":{"bottom":12,"leading":16,"top":12,"trailing":16},"shape":{"radius":14},"spacing":2,"type":"stack"},"type":"package"},{"is_selected_by_default":false,"package_id":"$rc_monthly","stack":{"components":[{"components":[{"font_size":16,"font_weight_int":600,"text_lid":"monthly","type":"text"},{"grow":true,"size":0,"type":"spacer"},{"background":{"value":{"light":{"type":"hex","value":"accent"}}},"components":[{"color":{"light":{"type":"hex","value":"on_accent"}},"font_size":11,"font_weight_int":700,"text_lid":"v_savings","type":"text"}],"dimension":"horizontal","padding":{"bottom":3,"leading":8,"top":3,"trailing":8},"shape":{"radius":6},"spacing":0,"type":"stack"},{"font_size":16,"font_weight_int":700,"text_lid":"v_price","type":"text"}],"dimension":"horizontal","spacing":8,"type":"stack"},{"font_size":12,"text_lid":"v_per_period","type":"text"}],"dimension":"vertical","overrides":[{"conditions":[{"type":"selected"}],"properties":{"background":"accent_soft","border":"accent","border_width":"2"}}],"padding":{"bottom":12,"leading":16,"top":12,"trailing":16},"shape":{"radius":14},"spacing":2,"type":"stack"},"type":"package"},{"size":8,"type":"spacer"},{"text_lid":"cta_continue","type":"purchase_button"},{"text_lid":"restore_label","type":"restore_purchases"}],"dimension":"vertical","padding":{"bottom":20,"leading":20,"top":20,"trailing":20},"spacing":16,"type":"stack"},"id":"paywall","is_last_step":true,"name":"Paywall screen"}]}'::jsonb),
  ('minimal', 'Minimal', 'Headline and plans, nothing else. Fits inside an onboarding flow.', 'simple', 30, 2,
   '{"initial_step_id":"paywall","localizations":{"en_US":{"annual":"Annual","cta_continue":"Continue","monthly":"Monthly","restore_label":"Restore Purchases","title":"Upgrade to Premium","v_per_period":"{{ product.price_per_period }}","v_price":"{{ product.price }}","v_savings":"{{ product.offer_savings_label }}"}},"schema_version":2,"steps":[{"components_config":{"components":[{"font_size":32,"font_weight_int":400,"text_lid":"title","type":"text"},{"is_selected_by_default":true,"package_id":"$rc_annual","stack":{"components":[{"components":[{"font_size":16,"font_weight_int":600,"text_lid":"annual","type":"text"},{"grow":true,"size":0,"type":"spacer"},{"background":{"value":{"light":{"type":"hex","value":"accent"}}},"components":[{"color":{"light":{"type":"hex","value":"on_accent"}},"font_size":11,"font_weight_int":700,"text_lid":"v_savings","type":"text"}],"dimension":"horizontal","padding":{"bottom":3,"leading":8,"top":3,"trailing":8},"shape":{"radius":6},"spacing":0,"type":"stack"},{"font_size":16,"font_weight_int":700,"text_lid":"v_price","type":"text"}],"dimension":"horizontal","spacing":8,"type":"stack"},{"font_size":12,"text_lid":"v_per_period","type":"text"}],"dimension":"vertical","overrides":[{"conditions":[{"type":"selected"}],"properties":{"background":"accent_soft","border":"accent","border_width":"2"}}],"padding":{"bottom":12,"leading":16,"top":12,"trailing":16},"shape":{"radius":14},"spacing":2,"type":"stack"},"type":"package"},{"is_selected_by_default":false,"package_id":"$rc_monthly","stack":{"components":[{"components":[{"font_size":16,"font_weight_int":600,"text_lid":"monthly","type":"text"},{"grow":true,"size":0,"type":"spacer"},{"background":{"value":{"light":{"type":"hex","value":"accent"}}},"components":[{"color":{"light":{"type":"hex","value":"on_accent"}},"font_size":11,"font_weight_int":700,"text_lid":"v_savings","type":"text"}],"dimension":"horizontal","padding":{"bottom":3,"leading":8,"top":3,"trailing":8},"shape":{"radius":6},"spacing":0,"type":"stack"},{"font_size":16,"font_weight_int":700,"text_lid":"v_price","type":"text"}],"dimension":"horizontal","spacing":8,"type":"stack"},{"font_size":12,"text_lid":"v_per_period","type":"text"}],"dimension":"vertical","overrides":[{"conditions":[{"type":"selected"}],"properties":{"background":"accent_soft","border":"accent","border_width":"2"}}],"padding":{"bottom":12,"leading":16,"top":12,"trailing":16},"shape":{"radius":14},"spacing":2,"type":"stack"},"type":"package"},{"size":8,"type":"spacer"},{"text_lid":"cta_continue","type":"purchase_button"},{"text_lid":"restore_label","type":"restore_purchases"}],"dimension":"vertical","padding":{"bottom":16,"leading":16,"top":16,"trailing":16},"spacing":12,"type":"stack"},"id":"paywall","is_last_step":true,"name":"Paywall screen"}]}'::jsonb),
  ('dark', 'Dark', 'Carries its own dark palette regardless of the host app''s theme.', 'simple', 40, 2,
   '{"color_scheme":"dark","initial_step_id":"paywall","localizations":{"en_US":{"annual":"Annual","cta_continue":"Continue","monthly":"Monthly","restore_label":"Restore Purchases","title":"Upgrade to Premium","v_per_period":"{{ product.price_per_period }}","v_price":"{{ product.price }}","v_savings":"{{ product.offer_savings_label }}"}},"schema_version":2,"steps":[{"components_config":{"background":{"value":{"light":{"type":"hex","value":"#121212ff"}}},"components":[{"color":{"light":{"type":"hex","value":"#FFFFFFff"}},"font_size":32,"font_weight_int":400,"text_lid":"title","type":"text"},{"is_selected_by_default":true,"package_id":"$rc_annual","stack":{"components":[{"components":[{"font_size":16,"font_weight_int":600,"text_lid":"annual","type":"text"},{"grow":true,"size":0,"type":"spacer"},{"background":{"value":{"light":{"type":"hex","value":"#9B7FE8ff"}}},"components":[{"color":{"light":{"type":"hex","value":"#121212ff"}},"font_size":11,"font_weight_int":700,"text_lid":"v_savings","type":"text"}],"dimension":"horizontal","padding":{"bottom":3,"leading":8,"top":3,"trailing":8},"shape":{"radius":6},"spacing":0,"type":"stack"},{"font_size":16,"font_weight_int":700,"text_lid":"v_price","type":"text"}],"dimension":"horizontal","spacing":8,"type":"stack"},{"font_size":12,"text_lid":"v_per_period","type":"text"}],"dimension":"vertical","overrides":[{"conditions":[{"type":"selected"}],"properties":{"background":"#9B7FE826","border":"#9B7FE8ff","border_width":"2"}}],"padding":{"bottom":12,"leading":16,"top":12,"trailing":16},"shape":{"radius":14},"spacing":2,"type":"stack"},"type":"package"},{"is_selected_by_default":false,"package_id":"$rc_monthly","stack":{"components":[{"components":[{"font_size":16,"font_weight_int":600,"text_lid":"monthly","type":"text"},{"grow":true,"size":0,"type":"spacer"},{"background":{"value":{"light":{"type":"hex","value":"#9B7FE8ff"}}},"components":[{"color":{"light":{"type":"hex","value":"#121212ff"}},"font_size":11,"font_weight_int":700,"text_lid":"v_savings","type":"text"}],"dimension":"horizontal","padding":{"bottom":3,"leading":8,"top":3,"trailing":8},"shape":{"radius":6},"spacing":0,"type":"stack"},{"font_size":16,"font_weight_int":700,"text_lid":"v_price","type":"text"}],"dimension":"horizontal","spacing":8,"type":"stack"},{"font_size":12,"text_lid":"v_per_period","type":"text"}],"dimension":"vertical","overrides":[{"conditions":[{"type":"selected"}],"properties":{"background":"#9B7FE826","border":"#9B7FE8ff","border_width":"2"}}],"padding":{"bottom":12,"leading":16,"top":12,"trailing":16},"shape":{"radius":14},"spacing":2,"type":"stack"},"type":"package"},{"size":8,"type":"spacer"},{"text_lid":"cta_continue","type":"purchase_button"},{"text_lid":"restore_label","type":"restore_purchases"}],"dimension":"vertical","padding":{"bottom":20,"leading":20,"top":20,"trailing":20},"spacing":16,"type":"stack"},"id":"paywall","is_last_step":true,"name":"Paywall screen"}]}'::jsonb)
ON CONFLICT (slug) DO UPDATE
  SET name           = EXCLUDED.name,
      description    = EXCLUDED.description,
      category       = EXCLUDED.category,
      sort_order     = EXCLUDED.sort_order,
      schema_version = EXCLUDED.schema_version,
      workflow       = EXCLUDED.workflow;

-- ── 3. Gallery read ────────────────────────────────────────────────────────────────────────────
-- Returns the workflow too: the dashboard renders a LIVE preview of each card from the same tree
-- the SDK would render, rather than a screenshot that silently goes stale.
CREATE OR REPLACE FUNCTION public.paywall_templates_list()
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(t ORDER BY t.sort_order, t.slug), '[]'::jsonb)
  FROM (
    SELECT slug, name, description, category, sort_order, schema_version, workflow, preview_url
    FROM public.paywall_templates
    WHERE is_active
  ) t;
$$;
COMMENT ON FUNCTION public.paywall_templates_list() IS
  'Active gallery templates, ordered. Includes each workflow so the dashboard can render live previews.';

-- ── 4. Apply a template to a tenant DRAFT ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tenant_paywall_apply_template(
  p_tenant UUID,
  p_slug   TEXT,
  p_mode   TEXT DEFAULT 'create'
)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_template  JSONB;
  v_existing  JSONB;
  v_merged    JSONB;
  v_locales   JSONB := '{}'::jsonb;
  v_locale    TEXT;
  v_base      JSONB;
  v_tenant_l  JSONB;
  v_kept      JSONB;
  v_revision  INT;
  v_preserved INT := 0;
BEGIN
  IF p_mode NOT IN ('create', 'update') THEN
    RAISE EXCEPTION 'mode must be create or update, got %', p_mode
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = p_tenant AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT workflow INTO v_template
  FROM public.paywall_templates WHERE slug = p_slug AND is_active;
  IF v_template IS NULL THEN
    RAISE EXCEPTION 'no active template with slug %', p_slug USING ERRCODE = 'no_data_found';
  END IF;

  v_merged := v_template;

  IF p_mode = 'update' THEN
    -- Merge against the DRAFT, falling back to the published tree: a tenant who has published but
    -- never drafted still has authored copy worth keeping.
    SELECT COALESCE(workflow, published_workflow) INTO v_existing
    FROM tenant_paywall WHERE tenant_id = p_tenant;

    IF v_existing IS NOT NULL AND v_existing ? 'localizations' THEN
      -- Walk the union of locales. A locale the template does not carry (the tenant's own
      -- translation) keeps its copy against the template's DEFAULT lid set, so translations
      -- survive taking a new layout — the case that makes "update from template" usable at all.
      FOR v_locale IN
        SELECT DISTINCT k FROM (
          SELECT jsonb_object_keys(COALESCE(v_template->'localizations',  '{}'::jsonb)) AS k
          UNION
          SELECT jsonb_object_keys(COALESCE(v_existing->'localizations', '{}'::jsonb)) AS k
        ) s
      LOOP
        v_base := COALESCE(
          v_template->'localizations'->v_locale,
          -- template has no such locale: use its first locale's lids as the key set
          (SELECT v_template->'localizations'->(jsonb_object_keys(v_template->'localizations')) LIMIT 1),
          '{}'::jsonb
        );
        v_tenant_l := COALESCE(v_existing->'localizations'->v_locale, '{}'::jsonb);

        -- Keep tenant text ONLY for lids the new structure still references. A dropped lid is copy
        -- with nothing to render it; carrying it forever would grow the tree with dead strings.
        SELECT COALESCE(jsonb_object_agg(key, value), '{}'::jsonb) INTO v_kept
        FROM jsonb_each(v_tenant_l) WHERE v_base ? key;

        v_preserved := v_preserved + (SELECT count(*) FROM jsonb_object_keys(v_kept));
        v_locales := v_locales || jsonb_build_object(v_locale, v_base || v_kept);
      END LOOP;

      v_merged := v_template || jsonb_build_object('localizations', v_locales);
    END IF;
  END IF;

  PERFORM public.validate_paywall_workflow(v_merged);

  INSERT INTO tenant_paywall (tenant_id, workflow, schema_version, revision, updated_at)
  VALUES (p_tenant, v_merged, COALESCE((v_merged->>'schema_version')::INT, 2), 1, now())
  ON CONFLICT (tenant_id) DO UPDATE
    SET workflow       = EXCLUDED.workflow,
        schema_version = EXCLUDED.schema_version,
        revision       = tenant_paywall.revision + 1,
        updated_at     = now()
  RETURNING revision INTO v_revision;

  -- The count is returned rather than logged so the dashboard can say "kept 7 of your strings"
  -- instead of "applied" — the difference between a user trusting the button and fearing it.
  RETURN jsonb_build_object(
    'slug', p_slug,
    'mode', p_mode,
    'revision', v_revision,
    'preserved_strings', v_preserved
  );
END;
$$;
COMMENT ON FUNCTION public.tenant_paywall_apply_template(UUID, TEXT, TEXT) IS
  'Loads a gallery template into the tenant DRAFT tree. mode=update keeps authored copy for lids the template still uses. Never touches published_workflow.';

REVOKE ALL ON FUNCTION public.tenant_paywall_apply_template(UUID, TEXT, TEXT) FROM anon;
REVOKE ALL ON FUNCTION public.paywall_templates_list() FROM anon;
GRANT EXECUTE ON FUNCTION public.tenant_paywall_apply_template(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.paywall_templates_list() TO authenticated;
