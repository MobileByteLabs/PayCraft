// supabase/functions/attempt-alerts/analytics-rules.ts
//
// The release / funnel alert rules (real-time analytics spec 2026-11-28, migration 224). Pure: one aggregate row
// from analytics_alert_* in, an AlertDraft out — or null when the rule does not fire. The SQL returns the
// candidates (volume gates); every contract threshold is decided here:
//
//   release_regression  newest app_version with >= 30 paywall-view devices has a purchase rate < 50% of the
//                       previous version's, OR a sign-in fail share > 2x the previous's     key: app_version
//   sign_in_failing     >= 5 sign-in failures AND fail share > 30% in the last 60 min       key: hour bucket
//   paywall_silent      0 paywall views in the last 60 min while the prior 7 days' same-hour mean >= 5
//                                                                                          key: hour bucket
//
// fail share = sign_in_fail / (sign_in_fail + sign_in_complete). Live mode only (the SQL filters it).

import type { AlertDraft } from "../_shared/alert-channels.ts"

// deno-lint-ignore no-explicit-any
type Any = any

export const RELEASE_MIN_DEVICES = 30
export const RELEASE_PURCHASE_RATE_RATIO = 0.5
export const RELEASE_FAIL_SHARE_MULTIPLIER = 2
export const RELEASE_WINDOW_DAYS = 7
export const SIGN_IN_MIN_FAILS = 5
export const SIGN_IN_FAIL_SHARE = 0.3
export const SIGN_IN_WINDOW_MINUTES = 60
export const SILENT_MIN_BASELINE = 5
export const SILENT_WINDOW_MINUTES = 60

/** "hour-2026-11-28T10" — the UTC hour of [now]. */
export const hourKey = (now: Date) => `hour-${now.toISOString().slice(0, 13)}`

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number(v))
const pct = (v: number) => `${(v * 100).toFixed(1)}%`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

export function releaseRegressionDraft(r: Any, now: Date): AlertDraft | null {
  if (!r.app_version || !r.previous_version || Number(r.paywall_view_devices) < RELEASE_MIN_DEVICES) return null
  const rate = num(r.purchase_rate), prevRate = num(r.prev_purchase_rate)
  const share = num(r.sign_in_fail_share), prevShare = num(r.prev_sign_in_fail_share)
  const purchaseDrop = rate !== null && prevRate !== null && prevRate > 0 && rate < RELEASE_PURCHASE_RATE_RATIO * prevRate
  // Floor like sign_in_failing: against a 0% previous version, one failure would otherwise "double" the share.
  const signInRise = share !== null && prevShare !== null && Number(r.sign_in_fails) >= SIGN_IN_MIN_FAILS &&
    share > RELEASE_FAIL_SHARE_MULTIPLIER * prevShare
  if (!purchaseDrop && !signInRise) return null
  const what = [purchaseDrop && "purchase rate down", signInRise && "sign-in failures up"].filter(Boolean).join(", ")
  return {
    tenantId: r.tenant_id,
    kind: "release_regression",
    severity: "critical",
    dedupeKey: String(r.app_version),
    title: `Release ${r.app_version} regressed — ${what}`,
    body: [
      `Version ${r.app_version} vs ${r.previous_version}, last ${RELEASE_WINDOW_DAYS} days (live):`,
      `Purchase rate ${rate === null ? "n/a" : pct(rate)} (${r.purchase_devices}/${r.paywall_view_devices} devices) vs ` +
      `${prevRate === null ? "n/a" : pct(prevRate)} (${r.prev_purchase_devices}/${r.prev_paywall_view_devices}).`,
      `Sign-in fail share ${share === null ? "n/a" : pct(share)} (${r.sign_in_fails} failed / ${r.sign_in_completes} ok) vs ` +
      `${prevShare === null ? "n/a" : pct(prevShare)} (${r.prev_sign_in_fails} / ${r.prev_sign_in_completes}).`,
    ].join("\n"),
    payload: {
      app_version: r.app_version, previous_version: r.previous_version, purchase_drop: purchaseDrop, sign_in_rise: signInRise,
      paywall_view_devices: r.paywall_view_devices, purchase_devices: r.purchase_devices, purchase_rate: rate,
      sign_in_fails: r.sign_in_fails, sign_in_completes: r.sign_in_completes, sign_in_fail_share: share,
      prev_paywall_view_devices: r.prev_paywall_view_devices, prev_purchase_devices: r.prev_purchase_devices,
      prev_purchase_rate: prevRate, prev_sign_in_fails: r.prev_sign_in_fails, prev_sign_in_completes: r.prev_sign_in_completes,
      prev_sign_in_fail_share: prevShare,
    },
    at: now,
  }
}

export function signInFailingDraft(r: Any, now: Date): AlertDraft | null {
  const fails = Number(r.sign_in_fails), oks = Number(r.sign_in_completes)
  const share = fails + oks > 0 ? fails / (fails + oks) : 0
  if (fails < SIGN_IN_MIN_FAILS || share <= SIGN_IN_FAIL_SHARE) return null
  const providers = Object.entries((r.fails_by_provider ?? {}) as Record<string, number>)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k} ${v}`).join(", ")
  return {
    tenantId: r.tenant_id,
    kind: "sign_in_failing",
    severity: "critical",
    dedupeKey: hourKey(now),
    title: `Sign-in failing — ${pct(share)} of sign-ins in the last hour`,
    body: [
      `${plural(fails, "sign-in failure")} and ${plural(oks, "successful sign-in")} in the last ${SIGN_IN_WINDOW_MINUTES} minutes (live).`,
      providers ? `By provider: ${providers}` : null,
    ].filter(Boolean).join("\n"),
    payload: {
      sign_in_fails: fails, sign_in_completes: oks, sign_in_fail_share: Number(share.toFixed(4)),
      fails_by_provider: r.fails_by_provider ?? {}, window_start: r.window_start, window_end: r.window_end,
    },
    at: now,
  }
}

export function paywallSilentDraft(r: Any, now: Date): AlertDraft | null {
  const views = Number(r.paywall_views), mean = Number(r.baseline_mean)
  if (views !== 0 || !(mean >= SILENT_MIN_BASELINE)) return null
  return {
    tenantId: r.tenant_id,
    kind: "paywall_silent",
    severity: "critical",
    dedupeKey: hourKey(now),
    title: "Paywall silent — no views in the last hour",
    body: `0 paywall views in the last ${SILENT_WINDOW_MINUTES} minutes (live), against an average of ${mean.toFixed(1)} ` +
      `in the same hour over the previous 7 days. The paywall may not be opening, or events are not arriving.`,
    payload: { paywall_views: 0, baseline_mean: mean, window_start: r.window_start, window_end: r.window_end },
    at: now,
  }
}
