// A buyer's purchase attempts with their timelines (paycraft-attempt-observability, GOAL D1 / D3 / AC-15).
//
// Reads `payment_attempts` (migration 210's view over checkout_attempts — security_invoker, so the caller's RLS
// applies too) and `attempt_events` (the append-only timeline). Every query is tenant-scoped explicitly as well:
// RLS lets an admin of several apps read all of them, and the page means ONE app.
//
// The buyer is never looked up by email in these tables: `user_ref` is sha256(tenant_id ':' lower(email)), the
// same hash the `events` function stamps on paywall_events, so the funnel and the attempts join on it.

import type { SupabaseClient } from "@supabase/supabase-js"

export const ATTEMPT_STATES = [
  "started", "checkout_opened", "provider_result", "granted", "failed", "abandoned", "paid_not_granted",
] as const
export type AttemptState = (typeof ATTEMPT_STATES)[number]

export const ATTEMPT_STAGES = ["sdk", "server", "provider", "webhook", "entitlement"] as const
export type AttemptStage = (typeof ATTEMPT_STAGES)[number]

export const STAGE_LABEL: Record<AttemptStage, string> = {
  sdk: "SDK", server: "Server", provider: "Provider", webhook: "Webhook", entitlement: "Entitlement",
}

export type Correlation = "exact" | "inferred" | null

export type AttemptEventRow = {
  occurred_at: string
  event: string
  stage: AttemptStage
  error_class: string | null
  error_code: string | null
  error_message: string | null
}

export type AttemptRow = {
  id: string
  attempt_id: string | null
  provider: string
  mode: "live" | "test"
  plan: string | null
  state: AttemptState
  correlation: Correlation
  match_rule: string | null
  stage: AttemptStage | null
  error_class: string | null
  error_code: string | null
  error_message: string | null
  started_at: string
  paid_at: string | null
  granted_at: string | null
  closed_at: string | null
  events: AttemptEventRow[]
}

/** Most attempts one buyer can have on the page; older ones are reachable through the MCP / SQL. */
export const TIMELINE_CAP = 50

export const ATTEMPT_COLUMNS =
  "id, attempt_id, provider, mode, plan, state, correlation, match_rule, stage, error_class, error_code, error_message, started_at, paid_at, granted_at, closed_at"
export const EVENT_COLUMNS = "attempt_id, occurred_at, event, stage, error_class, error_code, error_message"

/** The buyer hash `payment_attempts.user_ref` / `paywall_events.user_ref` carry for this tenant + email. */
export async function buyerRef(tenantId: string, email: string): Promise<string> {
  const bytes = new TextEncoder().encode(`${tenantId}:${email.toLowerCase()}`)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("")
}

/** A buyer's attempts, newest first, each with its timeline oldest first. Never another tenant's or buyer's rows. */
export async function fetchAttemptTimeline(
  sb: SupabaseClient,
  tenantId: string,
  userRef: string,
  limit: number = TIMELINE_CAP,
): Promise<AttemptRow[]> {
  if (!userRef) return []
  const { data: attempts, error } = await sb
    .from("payment_attempts")
    .select(ATTEMPT_COLUMNS)
    .eq("tenant_id", tenantId)
    .eq("user_ref", userRef)
    .order("started_at", { ascending: false })
    .limit(limit)
  if (error) throw new Error(`payment_attempts: ${error.message}`)
  if (!attempts?.length) return []

  const ids = attempts.map((a) => a.attempt_id).filter((id): id is string => typeof id === "string")
  const byAttempt = await fetchAttemptEvents(sb, tenantId, ids)
  return attempts.map((a) => ({ ...(a as Omit<AttemptRow, "events">), events: a.attempt_id ? byAttempt.get(a.attempt_id) ?? [] : [] }))
}

/** The timelines of these attempts (this tenant only), each oldest first, keyed by attempt_id. */
export async function fetchAttemptEvents(
  sb: SupabaseClient,
  tenantId: string,
  attemptIds: string[],
): Promise<Map<string, AttemptEventRow[]>> {
  const byAttempt = new Map<string, AttemptEventRow[]>()
  if (!attemptIds.length) return byAttempt
  const { data: events, error } = await sb
    .from("attempt_events")
    .select(EVENT_COLUMNS)
    .eq("tenant_id", tenantId)
    .in("attempt_id", attemptIds)
    .order("occurred_at", { ascending: true })
  if (error) throw new Error(`attempt_events: ${error.message}`)
  for (const e of events ?? []) {
    const list = byAttempt.get(e.attempt_id) ?? []
    list.push({
      occurred_at: e.occurred_at, event: e.event, stage: e.stage,
      error_class: e.error_class, error_code: e.error_code, error_message: e.error_message,
    })
    byAttempt.set(e.attempt_id, list)
  }
  return byAttempt
}

export const isFailureState = (s: AttemptState) => s === "failed" || s === "paid_not_granted"

/**
 * The timeline step an attempt failed at — the latest row carrying an error — or null when the attempt did not
 * fail. Falls back to the attempt's own failure columns' state row when no row carries a class.
 */
export function failingEvent(a: AttemptRow): AttemptEventRow | null {
  if (!isFailureState(a.state)) return null
  for (let i = a.events.length - 1; i >= 0; i--) {
    const e = a.events[i]
    if (e.error_class || e.error_code) return e
  }
  return [...a.events].reverse().find((e) => e.event === a.state) ?? null
}

const EVENT_LABEL: Record<string, string> = {
  started: "Plan selected",
  checkout_opened: "Checkout opened",
  provider_result: "Provider replied",
  granted: "Access granted",
  failed: "Failed",
  abandoned: "Abandoned",
  paid_not_granted: "Paid, not granted",
  failure: "Failure reported",
  paycraft_paywall_view: "Viewed paywall",
  paycraft_plan_select: "Plan selected",
  paycraft_provider_view: "Saw payment options",
  paycraft_provider_select: "Picked payment method",
  paycraft_checkout_start: "Started checkout",
  paycraft_checkout_return: "Returned from checkout",
  paycraft_purchase_success: "Purchase succeeded",
  paycraft_purchase_fail: "Purchase failed",
  paycraft_attempt_abandon: "Left the attempt",
  paycraft_step_abandon: "Left the paywall",
  paycraft_nudge_scheduled: "Resume reminder scheduled",
  paycraft_nudge_skipped: "Resume reminder skipped",
  paycraft_nudge_open: "Opened resume reminder",
  paycraft_sign_in_view: "Saw sign-in",
  paycraft_sign_in_complete: "Signed in",
}

/** A readable step name for a timeline event; unknown names are de-snaked, never hidden. */
export function eventLabel(event: string): string {
  if (EVENT_LABEL[event]) return EVENT_LABEL[event]
  if (event.startsWith("stitched:")) return `Matched by rule ${event.slice("stitched:".length)}`
  const words = event.replace(/^paycraft_/, "").replace(/_/g, " ").trim()
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : event
}
