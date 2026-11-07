/**
 * Partial paywall-copy edits over a whole-row upsert.
 *
 * `tenant_paywall_upsert` (migration 156) overwrites EVERY column from its payload, defaulting what
 * is absent — so "send only the field that changed" resets the rest to defaults (a hero title edit
 * would wipe the value props, the trial disclosure and all 14 settings_* strings). The dashboard
 * form survives this by always sending the whole object; an API caller naming one field cannot.
 *
 * So the merge happens here, server-side: read the current row, overlay ONLY the named fields, send
 * the whole thing back. Unknown keys are refused rather than dropped — a typo'd field that silently
 * did nothing would read as a successful edit.
 */

/** Every column `tenant_paywall_upsert` writes (156), minus `tenant_id` which comes from the key. */
export const PAYWALL_COPY_FIELDS = [
  "template", "theme_jsonb", "branding", "custom_footer", "primary_color", "font_family", "support_email",
  "hero_title", "hero_subtitle", "value_props", "cta_continue", "cta_get_premium", "restore_label",
  "terms_url", "privacy_url", "popular_plan_sku", "success_title", "success_message", "success_cta_label",
  "hero_icon_svg", "hero_icon_url",
  "trial_terms_template", "trial_disclosure_title", "trial_disclosure_body",
  "settings_free_label", "settings_trial_label", "settings_premium_label",
  "settings_free_supporting", "settings_trial_supporting",
  "settings_trial_ending_today", "settings_trial_one_day_left", "settings_trial_days_left",
  "settings_premium_supporting", "settings_renews_on", "settings_expires_on",
  "settings_manage_label", "settings_upgrade_label", "settings_restore_label",
] as const

const KNOWN = new Set<string>(PAYWALL_COPY_FIELDS)

export type MergeResult =
  | { row: Record<string, unknown>; changed: string[] }
  | { error: string; detail: string }

export function mergePaywallCopy(
  tenantId: string,
  current: Record<string, unknown> | null,
  fields: unknown,
): MergeResult {
  if (typeof fields !== "object" || fields === null || Array.isArray(fields)) {
    return { error: "fields_must_be_an_object", detail: "send { fields: { hero_title: \"…\" } }" }
  }
  const changed = Object.keys(fields)
  if (changed.length === 0) {
    return { error: "fields_must_name_at_least_one_field", detail: `known: ${PAYWALL_COPY_FIELDS.join(", ")}` }
  }
  const unknown = changed.filter((k) => !KNOWN.has(k))
  if (unknown.length) {
    return { error: "unknown_fields", detail: `not paywall fields: ${unknown.join(", ")}` }
  }

  const row: Record<string, unknown> = {}
  for (const k of PAYWALL_COPY_FIELDS) {
    if (current && current[k] !== undefined) row[k] = current[k]
  }
  Object.assign(row, fields)
  row.tenant_id = tenantId
  return { row, changed }
}
