-- 071 — tenant_paywall v2 content fields
--
-- Pairs with cmp-paycraft 2.1.0+ (sub-plan 02 of paycraft-paywall-v2-production-ui epic).
-- Adds 11 content fields driving the SDK BrandedStackTemplate render: hero copy + rich-triple
-- value props + CTA labels + restore label + terms/privacy URLs + popular plan SKU + success
-- copy + hero icon (inline SVG with sanitization OR URL fallback).
--
-- Defaults exactly match reels-downloader's existing strings.xml premium-banner keys so a
-- consumer dropping in PayCraftPremiumBanner() with NO overrides produces the same look.
--
-- All ADD COLUMN statements use IF NOT EXISTS for idempotent re-apply on supabase db reset.
-- The tenant_paywall_upsert RPC is replaced (CREATE OR REPLACE) with a v2-aware signature
-- that handles every new field, sanitizes hero_icon_svg server-side, and remains backward-
-- compatible with v1 payloads (missing fields fall through to column defaults).

-- ── 0. Extend paywall_template enum with the v2 default template ─────────
-- cmp-paycraft 2.1.0 ships BrandedStackTemplate as the new default; the legacy
-- minimal/premium/dark/gradient values stay for the 90-day @Deprecated grace.
-- Idempotent (ADD VALUE IF NOT EXISTS) so `supabase db reset` re-applies cleanly.
-- Ordered first so the tenant_paywall_upsert default below can reference it.
ALTER TYPE paywall_template ADD VALUE IF NOT EXISTS 'branded-stack';

-- ── 1. The 11 v2 content columns ────────────────────────────────────────
ALTER TABLE public.tenant_paywall
  ADD COLUMN IF NOT EXISTS hero_title       TEXT NOT NULL DEFAULT 'Upgrade to Premium',
  ADD COLUMN IF NOT EXISTS hero_subtitle    TEXT NOT NULL DEFAULT 'Enjoy ad-free experience, HD downloads, and exclusive features',
  ADD COLUMN IF NOT EXISTS value_props      JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS cta_continue     TEXT NOT NULL DEFAULT 'Continue',
  ADD COLUMN IF NOT EXISTS cta_get_premium  TEXT NOT NULL DEFAULT 'Get Premium',
  ADD COLUMN IF NOT EXISTS restore_label    TEXT NOT NULL DEFAULT 'Restore Your Premium',
  ADD COLUMN IF NOT EXISTS terms_url        TEXT,
  ADD COLUMN IF NOT EXISTS privacy_url      TEXT,
  ADD COLUMN IF NOT EXISTS popular_plan_sku TEXT,
  ADD COLUMN IF NOT EXISTS success_title    TEXT NOT NULL DEFAULT 'Welcome to Premium!',
  ADD COLUMN IF NOT EXISTS success_message  TEXT NOT NULL DEFAULT 'You now have access to all premium features.',
  ADD COLUMN IF NOT EXISTS success_cta_label TEXT NOT NULL DEFAULT 'Continue to app',
  ADD COLUMN IF NOT EXISTS hero_icon_svg    TEXT,
  ADD COLUMN IF NOT EXISTS hero_icon_url    TEXT;

COMMENT ON COLUMN public.tenant_paywall.hero_title IS 'Paywall + Settings-banner top-line headline (default: "Upgrade to Premium")';
COMMENT ON COLUMN public.tenant_paywall.hero_subtitle IS 'Sub-headline below the hero title (default: matches reels-downloader settings_premium_banner_subtitle)';
COMMENT ON COLUMN public.tenant_paywall.value_props IS 'JSONB array of {icon: string-key, title: string, description?: string} rich triples — rendered as icon-leading bullet list under hero';
COMMENT ON COLUMN public.tenant_paywall.popular_plan_sku IS 'SKU of the plan card that should render the MOST POPULAR ring (default: null → no ring)';
COMMENT ON COLUMN public.tenant_paywall.hero_icon_svg IS 'Inline SVG path data for the hero icon. Sanitized via sanitize_paywall_svg() — script/foreignObject/external URL refs rejected';
COMMENT ON COLUMN public.tenant_paywall.hero_icon_url IS 'PNG/raster fallback URL for the hero icon. Reserved for cmp-paycraft 2.2.0+ (URL loader). 2.1.0 reads inline SVG only; URL kept for forward-compat';

-- ── 2. SVG sanitization helper ──────────────────────────────────────────
-- IMMUTABLE function — same input always yields same output → can be used in CHECK constraints
-- and is safe for caching. Rejects three injection vectors:
--   • <script ...>                  — XSS
--   • <foreignObject ...>            — embeds arbitrary HTML
--   • href="http..." / xlink:href    — loads external resources, breaks CSP
CREATE OR REPLACE FUNCTION public.sanitize_paywall_svg(p_svg TEXT)
RETURNS TEXT
LANGUAGE plpgsql IMMUTABLE
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_svg IS NULL OR length(trim(p_svg)) = 0 THEN
    RETURN NULL;
  END IF;
  IF p_svg ~* '<\s*script\y' THEN
    RAISE EXCEPTION 'hero_icon_svg contains <script> — forbidden' USING ERRCODE = 'check_violation';
  END IF;
  IF p_svg ~* '<\s*foreignObject\y' THEN
    RAISE EXCEPTION 'hero_icon_svg contains <foreignObject> — forbidden' USING ERRCODE = 'check_violation';
  END IF;
  IF p_svg ~* '(xlink:)?href\s*=\s*"\s*https?://' THEN
    RAISE EXCEPTION 'hero_icon_svg contains external URL reference — forbidden' USING ERRCODE = 'check_violation';
  END IF;
  RETURN p_svg;
END;
$$;

COMMENT ON FUNCTION public.sanitize_paywall_svg(TEXT) IS
  'Validates SVG path data for tenant_paywall.hero_icon_svg. Rejects <script>, <foreignObject>, external URL refs. Used by tenant_paywall_upsert.';

-- ── 3. tenant_paywall_upsert v2 — handle 11 new fields + sanitize SVG ───
-- Replaces migration 030's flat 7-field RPC. Backward-compatible: v1 payloads (missing v2
-- fields) fall through to column defaults via COALESCE.
CREATE OR REPLACE FUNCTION public.tenant_paywall_upsert(p_row JSONB)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant UUID;
BEGIN
  v_tenant := (p_row->>'tenant_id')::UUID;
  IF v_tenant IS NULL THEN
    RAISE EXCEPTION 'tenant_id required' USING ERRCODE = 'invalid_parameter_value';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM tenant_admins WHERE tenant_id = v_tenant AND user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = 'insufficient_privilege';
  END IF;

  INSERT INTO tenant_paywall (
    -- v1 (migration 030)
    tenant_id, template, theme_jsonb, branding, custom_footer,
    primary_color, font_family, support_email,
    -- v2 (this migration)
    hero_title, hero_subtitle, value_props,
    cta_continue, cta_get_premium, restore_label,
    terms_url, privacy_url, popular_plan_sku,
    success_title, success_message, success_cta_label,
    hero_icon_svg, hero_icon_url,
    updated_at
  )
  VALUES (
    v_tenant,
    COALESCE(p_row->>'template', 'branded-stack')::paywall_template,
    COALESCE(p_row->'theme_jsonb', '{}'::jsonb),
    COALESCE(p_row->>'branding', 'attribution')::branding_mode,
    p_row->>'custom_footer',
    p_row->>'primary_color',
    p_row->>'font_family',
    p_row->>'support_email',
    COALESCE(p_row->>'hero_title', 'Upgrade to Premium'),
    COALESCE(p_row->>'hero_subtitle', 'Enjoy ad-free experience, HD downloads, and exclusive features'),
    COALESCE(p_row->'value_props', '[]'::jsonb),
    COALESCE(p_row->>'cta_continue', 'Continue'),
    COALESCE(p_row->>'cta_get_premium', 'Get Premium'),
    COALESCE(p_row->>'restore_label', 'Restore Your Premium'),
    p_row->>'terms_url',
    p_row->>'privacy_url',
    p_row->>'popular_plan_sku',
    COALESCE(p_row->>'success_title', 'Welcome to Premium!'),
    COALESCE(p_row->>'success_message', 'You now have access to all premium features.'),
    COALESCE(p_row->>'success_cta_label', 'Continue to app'),
    sanitize_paywall_svg(p_row->>'hero_icon_svg'),
    p_row->>'hero_icon_url',
    now()
  )
  ON CONFLICT (tenant_id) DO UPDATE SET
    template          = EXCLUDED.template,
    theme_jsonb       = EXCLUDED.theme_jsonb,
    branding          = EXCLUDED.branding,
    custom_footer     = EXCLUDED.custom_footer,
    primary_color     = EXCLUDED.primary_color,
    font_family       = EXCLUDED.font_family,
    support_email     = EXCLUDED.support_email,
    hero_title        = EXCLUDED.hero_title,
    hero_subtitle     = EXCLUDED.hero_subtitle,
    value_props       = EXCLUDED.value_props,
    cta_continue      = EXCLUDED.cta_continue,
    cta_get_premium   = EXCLUDED.cta_get_premium,
    restore_label     = EXCLUDED.restore_label,
    terms_url         = EXCLUDED.terms_url,
    privacy_url       = EXCLUDED.privacy_url,
    popular_plan_sku  = EXCLUDED.popular_plan_sku,
    success_title     = EXCLUDED.success_title,
    success_message   = EXCLUDED.success_message,
    success_cta_label = EXCLUDED.success_cta_label,
    hero_icon_svg     = EXCLUDED.hero_icon_svg,
    hero_icon_url     = EXCLUDED.hero_icon_url,
    updated_at        = now();
END;
$$;

COMMENT ON FUNCTION public.tenant_paywall_upsert(JSONB) IS
  'Idempotent upsert for tenant_paywall. v2 (migration 071) — accepts 11 new content fields + sanitizes hero_icon_svg.';

GRANT EXECUTE ON FUNCTION public.tenant_paywall_upsert(JSONB) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sanitize_paywall_svg(TEXT) TO authenticated, service_role;
