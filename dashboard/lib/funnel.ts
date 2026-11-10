// The paywall funnel the Analytics page shows (paycraft-paywall-analytics, GOAL D1 / AC-6).
//
// Computed from PayCraft's own `paywall_events` (written by the `events` edge function) — exact, unlike GA4,
// which lags and withholds low counts. Every stage counts DISTINCT buyers: a buyer is their account
// (`user_ref`, a hash) when signed in, else their device, so one person viewing the paywall three times is one
// viewer, and one person on a phone and a laptop is one buyer once signed in.

export const FUNNEL_STAGES = [
  "paycraft_paywall_view",
  "paycraft_plan_select",
  "paycraft_checkout_start",
  "paycraft_purchase_success",
] as const

export type FunnelStage = (typeof FUNNEL_STAGES)[number]

export type FunnelEvent = {
  name: string
  user_ref: string | null
  device_ref: string | null
  country: string | null
  provider: string | null
}

export type FunnelRow = {
  stage: FunnelStage
  users: number
  /** Share lost since the previous stage (0..1); null for the first stage or when the previous stage is empty. */
  dropFromPrev: number | null
  /** Share of the first stage that reached this one (0..1); null when nobody viewed. */
  ofFirst: number | null
}

const buyer = (e: Pick<FunnelEvent, "user_ref" | "device_ref">) => e.user_ref ?? e.device_ref ?? "anonymous"

function buyersAt(events: FunnelEvent[], stage: string): Set<string> {
  return new Set(events.filter((e) => e.name === stage).map(buyer))
}

export function funnel(events: FunnelEvent[]): FunnelRow[] {
  const reached = FUNNEL_STAGES.map((s) => buyersAt(events, s))
  const first = reached[0].size
  return FUNNEL_STAGES.map((stage, i) => {
    const users = reached[i].size
    const prev = i === 0 ? 0 : reached[i - 1].size
    return {
      stage,
      users,
      dropFromPrev: i === 0 || prev === 0 ? null : 1 - users / prev,
      ofFirst: first === 0 ? null : users / first,
    }
  })
}

export type SplitRow = { key: string; viewers: number; checkouts: number; payers: number }

/**
 * Viewers, checkout starters and payers per country or per provider, most viewers first. A null value is its own
 * "unknown" row — dropping it would make the rows add up to less than the funnel.
 */
export function splitBy(events: FunnelEvent[], field: "country" | "provider"): SplitRow[] {
  const rows = new Map<string, { viewers: Set<string>; checkouts: Set<string>; payers: Set<string> }>()
  const row = (k: string) => {
    let r = rows.get(k)
    if (!r) rows.set(k, (r = { viewers: new Set(), checkouts: new Set(), payers: new Set() }))
    return r
  }
  for (const e of events) {
    const k = e[field] ?? "unknown"
    if (e.name === "paycraft_paywall_view") row(k).viewers.add(buyer(e))
    else if (e.name === "paycraft_checkout_start") row(k).checkouts.add(buyer(e))
    else if (e.name === "paycraft_purchase_success") row(k).payers.add(buyer(e))
  }
  return [...rows.entries()]
    .map(([key, r]) => ({ key, viewers: r.viewers.size, checkouts: r.checkouts.size, payers: r.payers.size }))
    .sort((a, b) => b.viewers - a.viewers || b.checkouts - a.checkouts || a.key.localeCompare(b.key))
}

export const RANGE_OPTIONS = [7, 30, 90] as const

/** The range to show: the requested 7 / 30 / 90 days (default 30), capped at the plan's analytics retention. */
export function rangeDays(requested: string | undefined, retentionDays: number): { days: number; capped: boolean } {
  const n = Number(requested)
  const want = (RANGE_OPTIONS as readonly number[]).includes(n) ? n : 30
  return want > retentionDays ? { days: retentionDays, capped: true } : { days: want, capped: false }
}

export const STAGE_LABEL: Record<FunnelStage, string> = {
  paycraft_paywall_view: "Viewed paywall",
  paycraft_plan_select: "Picked a plan",
  paycraft_checkout_start: "Started checkout",
  paycraft_purchase_success: "Paid",
}
