// Dashboard twin of supabase/functions/_shared/trial.ts — the ONE trial rule. Keep the two identical:
// /config and checkout-initiate (Deno) already read an unset `trial_duration_days` as 7 days, while the
// Play/App Store sync and store readiness here read it as 0. So a product with `trial_enabled: true` and
// no length got a 7-day trial on the web and none on Play, and readiness saw no mismatch (Status Saver
// pro-annual, 2026-11-23). The edge-function file cannot be imported into the Next.js build, hence a twin.
export const DEFAULT_TRIAL_DAYS = 7

export function effectiveTrialDays(p: { type?: unknown; trial_enabled?: unknown; trial_duration_days?: unknown }): number {
  if (p.type != null && p.type !== "subscription") return 0
  if (p.trial_enabled === false) return 0
  const days = typeof p.trial_duration_days === "number" ? p.trial_duration_days : DEFAULT_TRIAL_DAYS
  return days > 0 ? days : 0
}
