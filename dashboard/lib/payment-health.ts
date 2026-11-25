// Payment health for the Analytics page (paycraft-attempt-observability, GOAL D1 / D15 / AC-15): where purchase
// attempts fail and where buyers give up, over the same window (and retention cap) the paywall funnel uses.
//
// Sources, all tenant-scoped and windowed:
//   · payment_attempts (210) — one row per attempt: final state, failure stage, provider.
//   · attempt_events  (210) — the timeline: which steps an attempt reached, and the SDK's nudge rows.
//   · paywall_events  (180) — the attempt's country, recorded server-side by the `events` function (a client
//     never states its own country), joined on attempt_id.
//
// Definitions (the numbers an owner reads, so they are spelled out):
//   failed            state failed OR paid_not_granted (the provider took money and no grant followed).
//   byStage           failures that ENDED at the stage ÷ every attempt in the window — the share of all attempts
//                     each stage lost; the rows add up to the overall failure rate.
//   byProvider/Country  failures ÷ that key's attempts.
//   abandonByStep     attempts abandoned with that step as the FURTHEST they reached ÷ attempts that reached it.
//   nudge.reach       resume reminders scheduled ÷ (scheduled + skipped for lack of notification permission);
//                     a reminder turned off by config is not a reach miss. null when no buyer was eligible.

import type { SupabaseClient } from "@supabase/supabase-js"
import type { AttemptState } from "@/lib/attempts"

export type HealthBucket = { key: string; total: number; failed: number; rate: number }

export const ABANDON_STEPS = ["plan_select", "checkout_open", "provider_result"] as const
export type AbandonStepKey = (typeof ABANDON_STEPS)[number]
export type AbandonStep = { step: AbandonStepKey; reached: number; abandoned: number; rate: number }

export type PaymentHealth = {
  totals: {
    attempts: number; granted: number; failed: number; paidNotGranted: number
    abandoned: number; open: number; grantRate: number
  }
  byStage: HealthBucket[]
  /** Failures by the reason the SDK or provider reported (error_code, e.g. product_not_found), as a share of all attempts. */
  byReason: HealthBucket[]
  byProvider: HealthBucket[]
  byCountry: HealthBucket[]
  abandonByStep: AbandonStep[]
  paidNotGranted: number
  nudge: { scheduled: number; skippedNoPermission: number; reach: number | null }
}

/** The timeline rows (state rows from the table's trigger, SDK rows from the events ingest) that prove a step. */
const STEP_EVENTS: Record<AbandonStepKey, readonly string[]> = {
  plan_select: ["started", "paycraft_plan_select"],
  checkout_open: ["checkout_opened", "paycraft_checkout_start"],
  provider_result: ["provider_result", "paycraft_checkout_return"],
}
/** A final state that by itself proves the attempt reached a step (no timeline row needed). */
const STATE_STEP: Partial<Record<AttemptState, AbandonStepKey>> = {
  checkout_opened: "checkout_open",
  provider_result: "provider_result",
  granted: "provider_result",
  paid_not_granted: "provider_result",
}
export const NUDGE_SCHEDULED = "paycraft_nudge_scheduled"
export const NUDGE_SKIPPED = "paycraft_nudge_skipped"
export const NUDGE_NO_PERMISSION = "skipped_no_permission"

const ROW_CAP = 50_000

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

/**
 * Every row a query matches, read page by page. The API returns at most `max_rows` (1 000 on Supabase) whatever a
 * `.limit` asks for, so one read silently dropped the rest; [page] builds the query for rows `from..to` over a stable
 * order, and the next page starts after however many rows actually came back — correct for any server cap.
 */
export async function readAll<T>(page: (from: number, to: number) => Page<T>, cap = ROW_CAP, size = 1000): Promise<T[]> {
  const out: T[] = []
  while (out.length < cap) {
    const { data, error } = await page(out.length, out.length + size - 1)
    if (error) throw new Error(error.message)
    if (!data?.length) break
    out.push(...data)
  }
  return out.slice(0, cap)
}

/** The platform a provider sells on — the same mapping paywall_funnel_stats uses (migration 215). */
export function providerPlatform(provider: string | null): string {
  return provider === "google_play" ? "android" : provider === "app_store" ? "ios" : "web"
}
const OPEN_STATES = new Set<AttemptState>(["started", "checkout_opened", "provider_result"])

const rate = (n: number, d: number) => (d === 0 ? 0 : n / d)
const isFailed = (s: AttemptState) => s === "failed" || s === "paid_not_granted"

type AttemptLite = {
  attempt_id: string | null
  state: AttemptState
  stage: string | null
  error_code: string | null
  provider: string | null
}

function bucketBy(rows: AttemptLite[], key: (r: AttemptLite) => string | null | undefined): HealthBucket[] {
  const by = new Map<string, { total: number; failed: number }>()
  for (const r of rows) {
    const k = key(r) || "unknown"
    const b = by.get(k) ?? { total: 0, failed: 0 }
    b.total++
    if (isFailed(r.state)) b.failed++
    by.set(k, b)
  }
  return [...by.entries()]
    .map(([k, v]) => ({ key: k, total: v.total, failed: v.failed, rate: rate(v.failed, v.total) }))
    .sort((a, b) => b.total - a.total || b.failed - a.failed || a.key.localeCompare(b.key))
}

export async function paymentHealth(
  sb: SupabaseClient,
  tenantId: string,
  mode: "live" | "test",
  sinceIso: string,
  /** Exclusive upper bound on when the attempt started; absent = up to now (the Analytics page). */
  untilIso?: string,
  /** The Analytics filters Payment health can apply. Plan and app version are not on an attempt reliably. */
  filters: { platform?: string; country?: string } = {},
): Promise<PaymentHealth> {
  const stepEvents = Object.values(STEP_EVENTS).flat()
  // Attempts are windowed on started_at; their events and country rows may land after `until` (a checkout that
  // started at 23:59 and returned at 00:01 is still that day's attempt), so only the attempts take the upper
  // bound — the events are keyed back to the attempts in the window below.
  const attemptsPage = (from: number, to: number) => {
    let q = sb.from("payment_attempts")
      .select("attempt_id, state, stage, error_code, provider")
      .eq("tenant_id", tenantId)
      .eq("mode", mode)
      .gte("started_at", sinceIso)
    if (untilIso) q = q.lt("started_at", untilIso)
    return q.order("id").range(from, to)
  }
  const named = <T>(table: string, p: Promise<T[]>) => p.catch((e: Error) => { throw new Error(`${table}: ${e.message}`) })
  const [attemptRows, eventRows, countryRows] = await Promise.all([
    named("payment_attempts", readAll<AttemptLite>(attemptsPage)),
    named("attempt_events", readAll<{ attempt_id: string; event: string; error_code: string | null }>((from, to) =>
      sb.from("attempt_events")
        .select("attempt_id, event, error_code")
        .eq("tenant_id", tenantId)
        .gte("occurred_at", sinceIso)
        .in("event", [...stepEvents, NUDGE_SCHEDULED, NUDGE_SKIPPED])
        .order("id").range(from, to), ROW_CAP * 4)),
    named("paywall_events", readAll<{ attempt_id: string; country: string | null }>((from, to) =>
      sb.from("paywall_events")
        .select("attempt_id, country")
        .eq("tenant_id", tenantId)
        .eq("mode", mode)
        .gte("occurred_at", sinceIso)
        .not("attempt_id", "is", null)
        .order("id").range(from, to))),
  ])

  const country = new Map<string, string>()
  for (const p of countryRows) {
    if (p.country && !country.has(p.attempt_id)) country.set(p.attempt_id, p.country)
  }

  // The Analytics filters (paycraft-ga4-analytics-audit): platform follows the provider, country the attempt's events.
  const wantPlatform = filters.platform?.toLowerCase()
  const wantCountry = filters.country?.toUpperCase()
  const rows = attemptRows.filter((r) =>
    (!wantPlatform || providerPlatform(r.provider) === wantPlatform) &&
    (!wantCountry || (r.attempt_id != null && country.get(r.attempt_id)?.toUpperCase() === wantCountry)),
  )
  // Only this mode's attempts in the window: events carry no mode, so they are keyed back to these ids.
  const inWindow = new Set(rows.map((r) => r.attempt_id).filter((id): id is string => !!id))

  const reached = new Map<string, Set<AbandonStepKey>>()
  const mark = (id: string, s: AbandonStepKey) => {
    const set = reached.get(id) ?? new Set<AbandonStepKey>()
    set.add(s)
    reached.set(id, set)
  }
  let scheduled = 0
  let skippedNoPermission = 0
  for (const e of eventRows) {
    if (!inWindow.has(e.attempt_id)) continue
    if (e.event === NUDGE_SCHEDULED) { scheduled++; continue }
    if (e.event === NUDGE_SKIPPED) { if (e.error_code === NUDGE_NO_PERMISSION) skippedNoPermission++; continue }
    for (const s of ABANDON_STEPS) if (STEP_EVENTS[s].includes(e.event)) mark(e.attempt_id, s)
  }

  // Every attempt starts at plan select. A later step counts only when the attempt PROVED it (a timeline row or
  // a state that implies it) — store lanes skip checkout_open on purpose, there is no server checkout page. The
  // furthest proved step is where an abandon is counted.
  const reachCount = new Map<AbandonStepKey, number>(ABANDON_STEPS.map((s) => [s, 0]))
  const abandonCount = new Map<AbandonStepKey, number>(ABANDON_STEPS.map((s) => [s, 0]))
  for (const r of rows) {
    const proved = new Set<AbandonStepKey>(r.attempt_id ? reached.get(r.attempt_id) ?? [] : [])
    proved.add("plan_select")
    const implied = STATE_STEP[r.state]
    if (implied) proved.add(implied)
    for (const s of proved) reachCount.set(s, reachCount.get(s)! + 1)
    if (r.state === "abandoned") {
      const furthest = [...ABANDON_STEPS].reverse().find((s) => proved.has(s))!
      abandonCount.set(furthest, abandonCount.get(furthest)! + 1)
    }
  }

  const count = (s: AttemptState) => rows.filter((r) => r.state === s).length
  const failedRows = rows.filter((r) => isFailed(r.state))
  const failureShare = (keyOf: (r: AttemptLite) => string | null): HealthBucket[] => {
    const counts = new Map<string, number>()
    for (const r of failedRows) counts.set(keyOf(r) ?? "unknown", (counts.get(keyOf(r) ?? "unknown") ?? 0) + 1)
    return [...counts.entries()]
      .map(([key, failed]) => ({ key, total: rows.length, failed, rate: rate(failed, rows.length) }))
      .sort((a, b) => b.failed - a.failed || a.key.localeCompare(b.key))
  }

  const paidNotGranted = count("paid_not_granted")
  return {
    totals: {
      attempts: rows.length,
      granted: count("granted"),
      failed: count("failed"),
      paidNotGranted,
      abandoned: count("abandoned"),
      open: rows.filter((r) => OPEN_STATES.has(r.state)).length,
      grantRate: rate(count("granted"), rows.length),
    },
    byStage: failureShare((r) => r.stage),
    byReason: failureShare((r) => r.error_code),
    byProvider: bucketBy(rows, (r) => r.provider),
    byCountry: bucketBy(rows, (r) => (r.attempt_id ? country.get(r.attempt_id) : null)),
    abandonByStep: ABANDON_STEPS.map((step) => {
      const r = reachCount.get(step)!
      const a = abandonCount.get(step)!
      return { step, reached: r, abandoned: a, rate: rate(a, r) }
    }),
    paidNotGranted,
    nudge: {
      scheduled,
      skippedNoPermission,
      reach: scheduled + skippedNoPermission === 0 ? null : scheduled / (scheduled + skippedNoPermission),
    },
  }
}
