-- 156 — dashboard-driven copy for the SDK's subscription-settings section.
--
-- ## Why
--
-- `PayCraftSubscriptionSettings` shipped with its wording in a PUBLIC Kotlin type
-- (`SubscriptionSettingsCopy`), defaulted to English and overridable by the host. That made the
-- strings hardcoded one layer lower rather than configurable: changing "Premium" to "Cappy Pro"
-- was an app release, while the same word on the paywall is a dashboard edit.
--
-- These columns move that copy to where the rest of the tenant's wording already lives, so the
-- settings section and the paywall are edited in one place and can never disagree.
--
-- ## Why DEFAULT '' and not the English text
--
-- Every other copy column (071, 077) defaults to its English string. That is wrong for a
-- localisable surface, and the SDK already shows why: it reads tenant copy as
-- `paywall.heroTitle.ifBlank { stringResource(...) }` — blank means "the tenant has not spoken,
-- use the bundled localised string". A column pre-filled with English makes that `ifBlank` dead for
-- every row, so the server silently overrides localisation with English for a tenant who never
-- touched the field.
--
-- Blank is therefore the only correct default here: an untouched tenant renders the SDK's own
-- translations, and a tenant who types something overrides them deliberately.
--
-- ## Tokens
--
-- Three of these are templates, following the `{...}` convention migration 077 established for
-- `trial_terms_template`:
--
--   settings_trial_days_left   {days}  e.g. "Trial — {days} days left"
--   settings_renews_on         {date}  e.g. "Renews {date}"
--   settings_expires_on        {date}  e.g. "Expires {date}"
--
-- `settings_trial_one_day_left` is a SEPARATE column rather than `settings_trial_days_left` with
-- days=1, because no token substitution can pluralise: a tenant who writes
-- "Trial — {days} days left" would otherwise get "Trial — 1 days left" on the last day.

-- ── 1. Columns ───────────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.tenant_paywall
  ADD COLUMN IF NOT EXISTS settings_free_label          TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS settings_trial_label         TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS settings_premium_label       TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS settings_free_supporting     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS settings_trial_supporting    TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS settings_trial_ending_today  TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS settings_trial_one_day_left  TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS settings_trial_days_left     TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS settings_premium_supporting  TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS settings_renews_on           TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS settings_expires_on          TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS settings_manage_label        TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS settings_upgrade_label       TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS settings_restore_label       TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN public.tenant_paywall.settings_free_label IS
  'Settings section tier name for a FREE user. Blank -> SDK bundled string.';
COMMENT ON COLUMN public.tenant_paywall.settings_trial_label IS
  'Settings section tier name during a trial. Blank -> SDK bundled string.';
COMMENT ON COLUMN public.tenant_paywall.settings_premium_label IS
  'Settings section tier name for a subscriber. Blank -> SDK bundled string.';
COMMENT ON COLUMN public.tenant_paywall.settings_free_supporting IS
  'Supporting line under the status for a FREE user. Blank -> SDK bundled string.';
COMMENT ON COLUMN public.tenant_paywall.settings_trial_supporting IS
  'Supporting line during a trial whose end date is unknown. Blank -> SDK bundled string.';
COMMENT ON COLUMN public.tenant_paywall.settings_trial_ending_today IS
  'Supporting line on the final day of a trial. Distinct from the {days} template because "0 days left" reads as already-expired.';
COMMENT ON COLUMN public.tenant_paywall.settings_trial_one_day_left IS
  'Supporting line with exactly one day of trial left. Separate column because token substitution cannot pluralise.';
COMMENT ON COLUMN public.tenant_paywall.settings_trial_days_left IS
  'Trial countdown template. Token {days} substituted by the SDK. Blank -> SDK bundled string.';
COMMENT ON COLUMN public.tenant_paywall.settings_premium_supporting IS
  'Supporting line for a subscriber with no known renewal date. Blank -> SDK bundled string.';
COMMENT ON COLUMN public.tenant_paywall.settings_renews_on IS
  'Renewal line template for a subscription that WILL renew. Token {date}. Blank -> SDK bundled string.';
COMMENT ON COLUMN public.tenant_paywall.settings_expires_on IS
  'Expiry line template for a subscription that will NOT renew (cancelled, still in period). Token {date}. Telling a cancelling user their subscription "renews" is the wording error this exists to prevent.';
COMMENT ON COLUMN public.tenant_paywall.settings_manage_label IS
  'Row label opening the store/provider subscription page. Blank -> SDK bundled string.';
COMMENT ON COLUMN public.tenant_paywall.settings_upgrade_label IS
  'Row label shown to a FREE user in place of Manage. Blank -> SDK bundled string.';
COMMENT ON COLUMN public.tenant_paywall.settings_restore_label IS
  'Row label opening the SDK restore flow. Blank -> SDK bundled string.';

-- ── 2. SDK read — tenant_paywall_public_get ──────────────────────────────────────────────────────
-- Restated in full (migration 101's allowlist) because this function names its fields explicitly on
-- purpose: a column added to tenant_paywall must not silently start shipping to every device. The
-- 14 new keys are appended; every pre-existing key is carried over byte-for-byte.
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
    -- Subscription-settings section copy (156). Blank values are emitted as-is: the SDK treats
    -- blank as "fall back to the bundled localised string", so stripping them here would be
    -- indistinguishable from the tenant having configured an empty label.
    'settings_free_label',         p.settings_free_label,
    'settings_trial_label',        p.settings_trial_label,
    'settings_premium_label',      p.settings_premium_label,
    'settings_free_supporting',    p.settings_free_supporting,
    'settings_trial_supporting',   p.settings_trial_supporting,
    'settings_trial_ending_today', p.settings_trial_ending_today,
    'settings_trial_one_day_left', p.settings_trial_one_day_left,
    'settings_trial_days_left',    p.settings_trial_days_left,
    'settings_premium_supporting', p.settings_premium_supporting,
    'settings_renews_on',          p.settings_renews_on,
    'settings_expires_on',         p.settings_expires_on,
    'settings_manage_label',       p.settings_manage_label,
    'settings_upgrade_label',      p.settings_upgrade_label,
    'settings_restore_label',      p.settings_restore_label,
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
  'SDK-facing paywall read. Emits published_workflow as `workflow` and NEVER the draft. /config must use this, not tenant_paywall_get. 156 — adds the settings_* section copy.';

-- ── 3. Dashboard write — tenant_paywall_upsert ───────────────────────────────────────────────────
-- Restated in full on top of migration 077. Backward-compatible: a payload omitting the settings_*
-- keys falls through to '' via COALESCE, which is the same value the columns default to.
--
-- NOTE this is a whole-row upsert, as it has been since 030: the dashboard PATCHes the entire
-- config object, and ON CONFLICT overwrites every column from it. A caller that sends a PARTIAL
-- object therefore blanks the fields it omitted. That is pre-existing behaviour for all 24 earlier
-- columns, not something these 14 introduce — but it is why the dashboard must keep sending the
-- full object rather than a diff.
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
    -- v2 (migration 071)
    hero_title, hero_subtitle, value_props,
    cta_continue, cta_get_premium, restore_label,
    terms_url, privacy_url, popular_plan_sku,
    success_title, success_message, success_cta_label,
    hero_icon_svg, hero_icon_url,
    -- trial disclosure (migration 077)
    trial_terms_template, trial_disclosure_title, trial_disclosure_body,
    -- settings section copy (migration 156)
    settings_free_label, settings_trial_label, settings_premium_label,
    settings_free_supporting, settings_trial_supporting,
    settings_trial_ending_today, settings_trial_one_day_left, settings_trial_days_left,
    settings_premium_supporting, settings_renews_on, settings_expires_on,
    settings_manage_label, settings_upgrade_label, settings_restore_label,
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
    COALESCE(p_row->>'trial_terms_template', '{days}-day free trial, then {price}'),
    COALESCE(p_row->>'trial_disclosure_title', '{days}-day free trial included'),
    COALESCE(p_row->>'trial_disclosure_body', 'Your free trial converts to a paid subscription automatically when it ends. Cancel anytime before then in your store subscription settings to avoid being charged.'),
    COALESCE(p_row->>'settings_free_label', ''),
    COALESCE(p_row->>'settings_trial_label', ''),
    COALESCE(p_row->>'settings_premium_label', ''),
    COALESCE(p_row->>'settings_free_supporting', ''),
    COALESCE(p_row->>'settings_trial_supporting', ''),
    COALESCE(p_row->>'settings_trial_ending_today', ''),
    COALESCE(p_row->>'settings_trial_one_day_left', ''),
    COALESCE(p_row->>'settings_trial_days_left', ''),
    COALESCE(p_row->>'settings_premium_supporting', ''),
    COALESCE(p_row->>'settings_renews_on', ''),
    COALESCE(p_row->>'settings_expires_on', ''),
    COALESCE(p_row->>'settings_manage_label', ''),
    COALESCE(p_row->>'settings_upgrade_label', ''),
    COALESCE(p_row->>'settings_restore_label', ''),
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
    trial_terms_template   = EXCLUDED.trial_terms_template,
    trial_disclosure_title = EXCLUDED.trial_disclosure_title,
    trial_disclosure_body  = EXCLUDED.trial_disclosure_body,
    settings_free_label         = EXCLUDED.settings_free_label,
    settings_trial_label        = EXCLUDED.settings_trial_label,
    settings_premium_label      = EXCLUDED.settings_premium_label,
    settings_free_supporting    = EXCLUDED.settings_free_supporting,
    settings_trial_supporting   = EXCLUDED.settings_trial_supporting,
    settings_trial_ending_today = EXCLUDED.settings_trial_ending_today,
    settings_trial_one_day_left = EXCLUDED.settings_trial_one_day_left,
    settings_trial_days_left    = EXCLUDED.settings_trial_days_left,
    settings_premium_supporting = EXCLUDED.settings_premium_supporting,
    settings_renews_on          = EXCLUDED.settings_renews_on,
    settings_expires_on         = EXCLUDED.settings_expires_on,
    settings_manage_label       = EXCLUDED.settings_manage_label,
    settings_upgrade_label      = EXCLUDED.settings_upgrade_label,
    settings_restore_label      = EXCLUDED.settings_restore_label,
    updated_at        = now();
END;
$$;

COMMENT ON FUNCTION public.tenant_paywall_upsert(JSONB) IS
  'Idempotent whole-row upsert for tenant_paywall. migration 156 — adds the 14 settings_* section-copy fields on top of 077.';

GRANT EXECUTE ON FUNCTION public.tenant_paywall_upsert(JSONB) TO authenticated;
