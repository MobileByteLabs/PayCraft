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
  step?: string | null
  reason: string | null
  provider: string | null
  sku?: string | null
  trigger?: string | null
  device_ref?: string | null
  app_version: string | null
  country: string | null
  platform: string
  mode: "live" | "test"
  occurred_at: string
}

export const STREAM_CAP = 200

// ── Time ranges ─────────────────────────────────────────────────────────────────────────────────────────────────

export type RangeKey = "1h" | "24h" | "7d" | "30d"
export type Bucket = "minute" | "hour" | "day"
export type LiveRange = { key: RangeKey; label: string; ms: number; bucket: Bucket; bucketMs: number }

const MINUTE = 60_000
const HOUR_MS = 60 * MINUTE
const DAY_MS = 24 * HOUR_MS

export const RANGES: LiveRange[] = [
  { key: "1h", label: "Last hour", ms: HOUR_MS, bucket: "minute", bucketMs: MINUTE },
  { key: "24h", label: "Last 24 hours", ms: DAY_MS, bucket: "hour", bucketMs: HOUR_MS },
  { key: "7d", label: "Last 7 days", ms: 7 * DAY_MS, bucket: "hour", bucketMs: HOUR_MS },
  { key: "30d", label: "Last 30 days", ms: 30 * DAY_MS, bucket: "day", bucketMs: DAY_MS },
]

export const rangeOf = (key: RangeKey): LiveRange => RANGES.find((r) => r.key === key) ?? RANGES[0]

/** One `paywall_live_series` row (migration 225): counts per (bucket, event name, app version). */
export type LiveSeriesRow = { bucket: string; name: string; app_version: string | null; events: number; devices: number }

export type SeriesPoint = { t: number; label: string; views: number; purchases: number }

/** Bins covering the range (oldest first) of paywall views + purchases, optionally for one version. */
export function seriesForRange(rows: LiveSeriesRow[], nowMs: number, range: LiveRange, version: string | null): SeriesPoint[] {
  const step = range.bucketMs
  const end = floorTo(nowMs, range.bucket)
  const count = Math.ceil(range.ms / step)
  const bins: SeriesPoint[] = []
  for (let i = count - 1; i >= 0; i--) {
    const t = end - i * step
    bins.push({ t, label: binLabel(t, range.bucket), views: 0, purchases: 0 })
  }
  const index = new Map(bins.map((b, i) => [b.t, i]))
  for (const r of rows) {
    if (version !== null && (r.app_version ?? "") !== version) continue
    const i = index.get(floorTo(Date.parse(r.bucket), range.bucket))
    if (i === undefined) continue
    if (r.name === "paycraft_paywall_view") bins[i].views += num(r.events)
    else if (r.name === "paycraft_purchase_success") bins[i].purchases += num(r.events)
  }
  return bins
}

/** Start of the minute / hour / UTC day containing `ms` — the same boundaries as the server's date_trunc. */
function floorTo(ms: number, bucket: Bucket): number {
  if (bucket === "minute") return Math.floor(ms / MINUTE) * MINUTE
  if (bucket === "hour") return Math.floor(ms / HOUR_MS) * HOUR_MS
  return Math.floor(ms / DAY_MS) * DAY_MS
}

function binLabel(t: number, bucket: Bucket): string {
  const d = new Date(t)
  if (bucket === "minute") return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
  if (bucket === "hour") return d.toLocaleString([], { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
  return d.toLocaleDateString([], { day: "numeric", month: "short" })
}

// ── Readable date-time ──────────────────────────────────────────────────────────────────────────────────────────

/** "28 Nov 2026, 12:14:02" in the viewer's locale and time zone. */
export function dateTime(iso: string): string {
  return new Date(iso).toLocaleString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
}

/** "just now", "3 min ago", "2 h ago", "4 days ago". */
export function ago(iso: string, nowMs: number): string {
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000))
  if (s < 45) return "just now"
  const m = Math.round(s / 60)
  if (m < 60) return `${m} min ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h} h ago`
  const d = Math.round(h / 24)
  return `${d} day${d === 1 ? "" : "s"} ago`
}

// ── What happened, in words ─────────────────────────────────────────────────────────────────────────────────────

/** "pro-quarterly" → "Quarterly", "pro_annual" → "Annual", "coins-100" → "Coins 100". */
export function planName(sku: string | null | undefined): string | null {
  if (!sku) return null
  const s = sku.replace(/^(pro|premium|plus)[-_]/i, "").replace(/[-_.]+/g, " ").trim()
  return s ? capitalise(s) : null
}

/** Where on the paywall a step is, as a phrase: "while choosing a plan". */
export const STEP_PLACES: Record<string, string> = {
  paywall: "on the paywall",
  plan: "while choosing a plan",
  provider: "on the payment-method choice",
  checkout: "at checkout",
  sign_in: "at sign-in",
  device_limit: "at the device-limit screen",
  survey: "on the exit survey",
  offer: "on the discount offer",
  restore: "on Restore purchases",
}

const PROVIDERS: Record<string, string> = {
  google_play: "Google Play",
  app_store: "the App Store",
  stripe: "Stripe",
  razorpay: "Razorpay",
  cashfree: "Cashfree",
  paddle: "Paddle",
}

const REASONS: Record<string, string> = {
  store_cancelled: "closed the store's payment sheet",
  too_expensive: "too expensive",
  just_looking: "just looking",
  payment_method: "payment method not available",
  no_trust: "doesn't trust it yet",
  more_features: "needs more features",
  other: "something else",
  found: "subscription found",
  not_found: "no subscription found",
  failed: "failed",
  done: "done",
  cancelled: "cancelled",
  rejected: "rejected by the provider",
  network: "network error",
  not_configured: "not configured",
  success: "payment confirmed",
  unconfirmed: "payment not confirmed yet",
  product_not_found: "plan not available in the store",
  checkout_abandon: "left checkout",
}

const reasonText = (r: string | null | undefined) => (r ? REASONS[r] ?? r.replace(/_/g, " ") : null)
const providerText = (p: string | null | undefined) => (p ? PROVIDERS[p] ?? capitalise(p.replace(/_/g, " ")) : null)

/**
 * One sentence saying what the buyer did and where: "Closed the paywall while choosing a plan (Quarterly)".
 * Falls back to the plain label for anything it doesn't know, so a new event name still reads sensibly.
 */
export function describeEvent(e: Pick<LiveEvent, "name" | "step" | "reason" | "provider" | "sku" | "trigger">): string {
  const plan = planName(e.sku)
  const on = plan ? ` (${plan})` : ""
  const via = providerText(e.provider)
  const why = reasonText(e.reason)
  switch (e.name) {
    case "paycraft_paywall_view":
      return e.trigger ? `Opened the paywall from ${e.trigger.replace(/_/g, " ")}` : "Opened the paywall"
    case "paycraft_plan_select":
      return `Picked a plan${on}`
    case "paycraft_provider_view":
      return `Saw the payment methods${on}`
    case "paycraft_provider_select":
      return `Chose to pay with ${via ?? "a payment method"}${on}`
    case "paycraft_checkout_start":
      return `Started checkout${via ? ` with ${via}` : ""}${on}`
    case "paycraft_checkout_return":
      return `Came back from checkout${why ? ` — ${why}` : ""}${on}`
    case "paycraft_purchase_success":
      return `Bought${on}${via ? ` with ${via}` : ""}`
    case "paycraft_purchase_fail":
      return `Payment failed${why ? ` — ${why}` : ""}${on}`
    case "paycraft_step_abandon":
      if (e.reason === "store_cancelled") return `Closed ${via ?? "the store"}'s payment sheet without paying${on}`
      return `Left ${STEP_PLACES[e.step ?? ""] ?? "the paywall"}${on}`
    case "paycraft_attempt_abandon":
      return `Switched to another plan before paying${on}`
    case "paycraft_sign_in_view":
      return `Was asked to sign in${e.reason ? ` (${e.reason})` : ""}`
    case "paycraft_sign_in_complete":
      return "Signed in"
    case "paycraft_sign_in_fail":
      return `Sign-in failed${why ? ` — ${why}` : ""}${via ? ` (${via})` : ""}`
    case "paycraft_device_limit_view":
      return "Hit the device limit"
    case "paycraft_device_transfer":
      return e.reason === "done" ? "Moved the subscription to this device" : "Device transfer failed"
    case "paycraft_restore_result":
      return `Restore purchases — ${why ?? "result unknown"}`
    case "paycraft_survey_view":
      return "Was shown the exit survey"
    case "paycraft_survey_answer":
      return `Answered the exit survey: ${why ?? "—"}`
    case "paycraft_offer_view":
      return `Was offered a discount${e.reason ? ` (${e.reason.replace(/pct$/, "% off")})` : ""}`
    case "paycraft_offer_accept":
      return "Claimed the discount"
    case "paycraft_offer_decline":
      return "Declined the discount"
    case "paycraft_nudge_scheduled":
      return `A reminder was scheduled${why ? ` (${why})` : ""}`
    case "paycraft_nudge_skipped":
      return "A reminder was skipped (no notification permission)"
    case "paycraft_nudge_open":
      return "Opened a reminder"
    default:
      return eventLabel(e.name, e.reason)
  }
}

// ── Journeys: one buyer visit, start to end ─────────────────────────────────────────────────────────────────────

export type Journey = {
  key: string
  device: string
  start: string
  end: string
  events: LiveEvent[]
  /** "Bought Quarterly", "Left at checkout (Quarterly)", "Still on the paywall". */
  outcome: string
  bought: boolean
  app_version: string | null
  country: string | null
}

const VISIT_GAP_MS = 30 * MINUTE

/** Groups events by device into visits (a gap of 30 min starts a new visit), newest visit first. */
export function journeys(events: LiveEvent[]): Journey[] {
  const byDevice = new Map<string, LiveEvent[]>()
  for (const e of events) {
    const d = e.device_ref ?? `event-${e.id}`
    const list = byDevice.get(d)
    if (list) list.push(e)
    else byDevice.set(d, [e])
  }
  const out: Journey[] = []
  for (const [device, list] of byDevice) {
    const sorted = [...list].sort((a, b) => Date.parse(a.occurred_at) - Date.parse(b.occurred_at) || a.id - b.id)
    let visit: LiveEvent[] = []
    for (const e of sorted) {
      const last = visit[visit.length - 1]
      if (last && Date.parse(e.occurred_at) - Date.parse(last.occurred_at) > VISIT_GAP_MS) {
        out.push(toJourney(device, visit))
        visit = []
      }
      visit.push(e)
    }
    if (visit.length) out.push(toJourney(device, visit))
  }
  return out.sort((a, b) => Date.parse(b.end) - Date.parse(a.end))
}

function toJourney(device: string, events: LiveEvent[]): Journey {
  const first = events[0]
  const last = events[events.length - 1]
  const bought = events.find((e) => e.name === "paycraft_purchase_success")
  const lastExit = [...events].reverse().find((e) => EXIT_NAMES.has(e.name))
  const lastPlan = [...events].reverse().find((e) => e.sku)?.sku
  let outcome: string
  if (bought) outcome = `Bought ${planName(bought.sku) ?? "a plan"}`
  else if (lastExit) outcome = describeEvent({ ...lastExit, sku: lastExit.sku ?? lastPlan })
  else outcome = `Last: ${describeEvent(last)}`
  return {
    key: `${device}:${first.id}`,
    device: device.startsWith("event-") ? "—" : `…${device.slice(-6)}`,
    start: first.occurred_at,
    end: last.occurred_at,
    events,
    outcome,
    bought: !!bought,
    app_version: events.find((e) => e.app_version)?.app_version ?? null,
    country: events.find((e) => e.country)?.country ?? null,
  }
}

const EXIT_NAMES = new Set(["paycraft_step_abandon", "paycraft_offer_decline", "paycraft_purchase_fail", "paycraft_attempt_abandon"])

// ── Where buyers leave ──────────────────────────────────────────────────────────────────────────────────────────

/** One `paywall_exit_steps` row (migration 225). */
export type ExitStepRow = { name: string; step: string; reason: string; sku: string; exits: number; devices: number }

export type ExitLine = { description: string; devices: number; exits: number; share: number }

/** Exit rows in words with each one's share of all leaving devices, biggest first. */
export function exitLines(rows: ExitStepRow[]): ExitLine[] {
  const total = rows.reduce((s, r) => s + num(r.devices), 0)
  return rows
    .map((r) => ({
      description: describeEvent({ name: r.name, step: r.step, reason: r.reason || null, provider: null, sku: r.sku || null }),
      devices: num(r.devices),
      exits: num(r.exits),
      share: total === 0 ? 0 : num(r.devices) / total,
    }))
    .sort((a, b) => b.devices - a.devices || b.exits - a.exits)
}

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
  // The RPCs report a missing version as 'unknown' — it sorts with the unreported, last.
  if (a === null || a === "" || a === "unknown") return 1
  if (b === null || b === "" || b === "unknown") return -1
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
