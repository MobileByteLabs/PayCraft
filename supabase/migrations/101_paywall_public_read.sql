-- 101_paywall_public_read.sql
--
-- Epic 2 Phase 1b — the SDK-facing read side.
--
-- FIXES A LEAK MIGRATION 100 OPENED
--   `tenant_paywall_get` is `SELECT * FROM tenant_paywall` returning the whole row type, and
--   `/config` spreads that row straight into the SDK payload. The moment 100 added `workflow`
--   (the DRAFT), every app on every device began receiving unpublished work — next quarter's
--   pricing, half-written copy — and paying twice the bytes for it.
--
--   The draft/published split is worthless if the transport ships both. So the SDK gets its own
--   reader that can only see published state; `tenant_paywall_get` stays as-is for the dashboard,
--   which legitimately edits the draft. Two consumers with opposite needs, two functions — rather
--   than one function trying to serve both and leaking to the weaker-privileged caller.
--
-- D8 / AC-11 — offerings and packages terminate in the database today (088 created the tables and
-- nothing surfaced them). A component tree binds to package ROLES (`$rc_annual`), never SKUs, so
-- the SDK cannot resolve a `package` node without this.

-- ── 1. SDK-safe paywall read ───────────────────────────────────────────────────────────────────
-- Returns jsonb rather than the row type precisely so the shape is CHOSEN rather than inherited:
-- a column added to tenant_paywall later cannot silently start shipping to clients.
CREATE OR REPLACE FUNCTION public.tenant_paywall_public_get(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    -- v1 flat columns — still the render path for every SDK older than the tree (D7).
    'template',               p.template,
    'theme_jsonb',            p.theme_jsonb,
    'branding',               p.branding,
    'custom_footer',          p.custom_footer,
    'primary_color',          p.primary_color,
    'font_family',            p.font_family,
    'support_email',          p.support_email,
    'hero_title',             p.hero_title,
    'hero_subtitle',          p.hero_subtitle,
    'value_props',            p.value_props,
    'cta_continue',           p.cta_continue,
    'cta_get_premium',        p.cta_get_premium,
    'restore_label',          p.restore_label,
    'terms_url',              p.terms_url,
    'privacy_url',            p.privacy_url,
    'popular_plan_sku',       p.popular_plan_sku,
    'success_title',          p.success_title,
    'success_message',        p.success_message,
    'success_cta_label',      p.success_cta_label,
    'hero_icon_svg',          p.hero_icon_svg,
    'hero_icon_url',          p.hero_icon_url,
    'trial_terms_template',   p.trial_terms_template,
    'trial_disclosure_title', p.trial_disclosure_title,
    'trial_disclosure_body',  p.trial_disclosure_body,
    -- v2 component tree. Named `workflow` on the wire and fed ONLY from published_workflow, so a
    -- client literally has no field in which a draft could arrive.
    'workflow',               p.published_workflow,
    'schema_version',         CASE WHEN p.published_workflow IS NULL THEN 1 ELSE p.schema_version END,
    'revision',               p.published_revision,
    'published_at',           p.published_at
  )
  FROM tenant_paywall p
  WHERE p.tenant_id = p_tenant_id;
$$;

COMMENT ON FUNCTION public.tenant_paywall_public_get(UUID) IS
  'SDK-facing paywall read. Emits published_workflow as `workflow` and NEVER the draft. /config must use this, not tenant_paywall_get.';

-- ── 2. Offerings + packages for the SDK (D8 / AC-11) ───────────────────────────────────────────
-- Shaped as offering → packages[] → product skus[] because that is how a `package` node resolves:
-- role identifier first, concrete products second.
CREATE OR REPLACE FUNCTION public.tenant_offerings_public_list(p_tenant_id UUID)
RETURNS JSONB
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(o ORDER BY o->>'identifier'), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'id',           off.id,
      'identifier',   off.identifier,
      'display_name', off.display_name,
      'is_current',   off.is_current,
      'packages',     COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
                 'id',              pkg.id,
                 'role_identifier', pkg.role_identifier,
                 'display_name',    pkg.display_name,
                 'display_order',   pkg.display_order,
                 -- A role can front more than one SKU (per-platform store ids), so this is an array.
                 'product_skus',    COALESCE((
                     SELECT jsonb_agg(pr.sku ORDER BY pr.display_order)
                     FROM tenant_products pr
                     WHERE pr.package_id = pkg.id AND pr.active
                   ), '[]'::jsonb)
               ) ORDER BY pkg.display_order)
        FROM tenant_packages pkg
        WHERE pkg.offering_id = off.id AND pkg.active
      ), '[]'::jsonb)
    ) AS o
    FROM tenant_offerings off
    WHERE off.tenant_id = p_tenant_id AND off.active
  ) s;
$$;

COMMENT ON FUNCTION public.tenant_offerings_public_list(UUID) IS
  'SDK-facing offerings → packages → product skus. Lets a component tree bind to package ROLES ($rc_annual) instead of SKUs (D8/AC-11).';

GRANT EXECUTE ON FUNCTION public.tenant_paywall_public_get(UUID)    TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.tenant_offerings_public_list(UUID) TO anon, authenticated, service_role;
