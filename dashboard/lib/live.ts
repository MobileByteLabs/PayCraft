// Live page (realtime analytics, docs/superpowers/specs/2026-11-28-realtime-analytics-design.md): pure helpers over
// the two migration-223 RPCs (`paywall_live_minutes`, `paywall_version_compare`) and the realtime paywall_events
// stream. Kept free of React so they are unit-tested in __tests__/lib/live.test.ts.

/** One `paywall_live_minutes` row: per-minute counts of one event name for one app version. */
export type LiveMinuteRow = { minute: string; name: string; app_version: string | null; events: number; devices: number }

/** One `paywall_version_compare` row, per app_version. */
export type VersionCompareRow = {
  app_version: string | null
  devices: number
  paywall_views: number
  purchases: number
  purchase_rate: number | null
  sign_in_views: number
  sign_in_completes: number
  sign_in_fails: number
  restores_found: number
  restores_not_found: number
  device_limit_views: number
  device_transfers: number
  first_seen: string | null
  last_seen: string | null
}

/** A paywall_events row as the stream shows it (seed SELECT + realtime INSERT payloads). */
export type LiveEvent = {
  id: number
  name: string
  reason: string | null
  provider: string | null
  app_version: string | null
  country: string | null
  platform: string
  mode: "live" | "test"
  occurred_at: string
}

export const STREAM_CAP = 200

/** Human labels for the SDK's event catalog (PayCraftEventName). */
export const EVENT_LABELS: Record<string, string> = {
  paycraft_paywall_view: "Paywall viewed",
  paycraft_plan_select: "Plan selected",
  paycraft_provider_view: "Payment methods shown",
  paycraft_provider_select: "Payment method chosen",
  paycraft_checkout_start: "Checkout started",
  paycraft_checkout_return: "Returned from checkout",
  paycraft_purchase_success: "Purchase completed",
  paycraft_purchase_fail: "Purchase failed",
  paycraft_sign_in_view: "Sign-in shown",
  paycraft_sign_in_complete: "Signed in",
  paycraft_sign_in_fail: "Sign-in failed",
  paycraft_device_limit_view: "Device limit shown",
  paycraft_device_transfer: "Device transfer",
  paycraft_restore_result: "Restore",
  paycraft_step_abandon: "Left the step",
  paycraft_survey_view: "Exit survey shown",
  paycraft_survey_answer: "Exit survey answered",
  paycraft_offer_view: "Offer shown",
  paycraft_offer_accept: "Offer accepted",
  paycraft_offer_decline: "Offer declined",
  paycraft_attempt_abandon: "Attempt replaced",
  paycraft_nudge_scheduled: "Reminder scheduled",
  paycraft_nudge_skipped: "Reminder skipped",
  paycraft_nudge_open: "Reminder opened",
}

/** "Restore: found", "Device transfer: failed", "Paywall viewed"; an unknown name is humanised, never dropped. */
export function eventLabel(name: string, reason?: string | null): string {
  const base = EVENT_LABELS[name] ?? capitalise(name.replace(/^paycraft_/, "").replace(/_/g, " "))
  const withReason = name === "paycraft_restore_result" || name === "paycraft_device_transfer"
  return withReason && reason ? `${base}: ${reason.replace(/_/g, " ")}` : base
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export type LiveCounters = {
  paywallViews: number
  purchases: number
  signInsOk: number
  signInsFailed: number
  restoresFound: number
  restoresNotFound: number
  deviceLimitViews: number
}

const ZERO: LiveCounters = {
  paywallViews: 0,
  purchases: 0,
  signInsOk: 0,
  signInsFailed: 0,
  restoresFound: 0,
  restoresNotFound: 0,
  deviceLimitViews: 0,
}

/** Last-60-min counters from `paywall_version_compare(since = now-60m)`, optionally for one app version. */
export function countersFromCompare(rows: VersionCompareRow[], version: string | null): LiveCounters {
  return rows
    .filter((r) => version === null || (r.app_version ?? "") === version)
    .reduce(
      (c, r) => ({
        paywallViews: c.paywallViews + num(r.paywall_views),
        purchases: c.purchases + num(r.purchases),
        signInsOk: c.signInsOk + num(r.sign_in_completes),
        signInsFailed: c.signInsFailed + num(r.sign_in_fails),
        restoresFound: c.restoresFound + num(r.restores_found),
        restoresNotFound: c.restoresNotFound + num(r.restores_not_found),
        deviceLimitViews: c.deviceLimitViews + num(r.device_limit_views),
      }),
      ZERO,
    )
}

/** The same counters from raw events (used when a country is picked — the RPCs carry no country). */
export function countersFromEvents(events: LiveEvent[], sinceMs: number): LiveCounters {
  const c = { ...ZERO }
  for (const e of events) {
    if (Date.parse(e.occurred_at) < sinceMs) continue
    if (e.name === "paycraft_paywall_view") c.paywallViews++
    else if (e.name === "paycraft_purchase_success") c.purchases++
    else if (e.name === "paycraft_sign_in_complete") c.signInsOk++
    else if (e.name === "paycraft_sign_in_fail") c.signInsFailed++
    else if (e.name === "paycraft_device_limit_view") c.deviceLimitViews++
    else if (e.name === "paycraft_restore_result" && e.reason === "found") c.restoresFound++
    else if (e.name === "paycraft_restore_result" && e.reason === "not_found") c.restoresNotFound++
  }
  return c
}

export type MinutePoint = { t: number; label: string; views: number; purchases: number }

/** 60 one-minute bins ending at `nowMs` (oldest first) of paywall views + purchases, optionally for one version. */
export function minuteSeries(rows: LiveMinuteRow[], nowMs: number, version: string | null): MinutePoint[] {
  const end = Math.floor(nowMs / 60_000) * 60_000
  const bins: MinutePoint[] = []
  for (let i = 59; i >= 0; i--) {
    const t = end - i * 60_000
    bins.push({ t, label: new Date(t).toISOString().slice(11, 16), views: 0, purchases: 0 })
  }
  const start = bins[0].t
  for (const r of rows) {
    if (version !== null && (r.app_version ?? "") !== version) continue
    const idx = Math.floor((Math.floor(Date.parse(r.minute) / 60_000) * 60_000 - start) / 60_000)
    if (idx < 0 || idx >= bins.length) continue
    if (r.name === "paycraft_paywall_view") bins[idx].views += num(r.events)
    else if (r.name === "paycraft_purchase_success") bins[idx].purchases += num(r.events)
  }
  return bins
}

/** Share of sign-in attempts that failed (0..1), null when there were none. */
export function signInFailShare(r: Pick<VersionCompareRow, "sign_in_completes" | "sign_in_fails">): number | null {
  const total = num(r.sign_in_completes) + num(r.sign_in_fails)
  return total === 0 ? null : num(r.sign_in_fails) / total
}

export type VersionRow = VersionCompareRow & {
  failShare: number | null
  /** Change vs the next-older version, in fraction points; null for the oldest row or a missing side. */
  purchaseRateDelta: number | null
  failShareDelta: number | null
}

/** Numeric-aware descending version order (1.10 above 1.9); unreported (null) versions last. */
export function compareVersionsDesc(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a === null || a === "") return 1
  if (b === null || b === "") return -1
  return b.localeCompare(a, undefined, { numeric: true })
}

/** Newest version first, each with its delta vs the next-older version. */
export function versionTable(rows: VersionCompareRow[]): VersionRow[] {
  const sorted = [...rows].sort((a, b) => compareVersionsDesc(a.app_version, b.app_version))
  return sorted.map((r, i) => {
    const older = sorted[i + 1]
    const failShare = signInFailShare(r)
    const olderFail = older ? signInFailShare(older) : null
    return {
      ...r,
      failShare,
      purchaseRateDelta: delta(r.purchase_rate, older?.purchase_rate ?? null),
      failShareDelta: delta(failShare, olderFail),
    }
  })
}

export function delta(now: number | null, before: number | null): number | null {
  return now === null || before === null ? null : now - before
}

/** Newest first, duplicates (seed ∩ realtime) dropped, capped. */
export function pushEvent(buffer: LiveEvent[], event: LiveEvent, cap = STREAM_CAP): LiveEvent[] {
  if (buffer.some((e) => e.id === event.id)) return buffer
  return [event, ...buffer].slice(0, cap)
}

/** Distinct reported values of a field, sorted. */
export function distinct(values: (string | null | undefined)[]): string[] {
  return [...new Set(values.filter((v): v is string => !!v))].sort()
}

const num = (v: unknown) => (typeof v === "number" ? v : Number(v) || 0)
