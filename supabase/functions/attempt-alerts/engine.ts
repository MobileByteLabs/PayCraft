// supabase/functions/attempt-alerts/engine.ts
//
// The attempt alert rules (paycraft-attempt-observability D9) over the attempt record and its timeline
// (migration 210), evaluated by the read-only aggregates of migration 211 on an injected clock:
//
//   critical — sent the moment a run sees them (attempt-stitch runs this every 5 minutes, after stitching):
//     paid_not_granted    the provider took the money and no entitlement followed   key: attempt_id
//     webhook_sig_fail    webhooks refused because their signature did not verify   key: provider code
//     webhook_proc_fail   webhooks verified but the handler could not process them  key: error class
//     failure_rate_spike  last hour's failures at a stage >= 3x the trailing 7-day hourly rate AND >= 5
//                                                                                    key: stage
//   digest — bundled once per tenant per hour (the hourly cron):
//     abandon_digest / decline_digest  the previous whole UTC hour                  key: hour-YYYY-MM-DDTHH
//
// Every alert goes through _shared/alert-channels.ts#deliverAlert: stored first (24 h dedupe per
// (tenant, kind, key), the tenant's per-kind toggle), then every enabled channel in parallel. Each rule runs
// on its own — one failing rule is reported in `errors` and never stops the others — and every run ends by
// re-sending the deliveries whose retry is due.

import {
  type AlertDraft,
  type Channel,
  CHANNELS,
  type ChannelDeps,
  deliverAlert,
  type DeliveryOutcome,
  dispatchAlert,
  recordAlert,
  retryDueDeliveries,
} from "../_shared/alert-channels.ts"

// deno-lint-ignore no-explicit-any
type Any = any

export const SPIKE_MIN_FAILURES = 5
export const SPIKE_MULTIPLIER = 3
/** paid_not_granted attempts flagged within this many minutes are alerted (dedupe keeps it to one each). */
export const PAID_NOT_GRANTED_LOOKBACK_MINUTES = 24 * 60
/** Webhook failures counted per critical run. */
export const WEBHOOK_WINDOW_MINUTES = 60

export type AlertMode = "critical" | "digest" | "retry"

export interface AlertRunResult {
  mode: AlertMode
  at: string
  created: number
  deduped: number
  deliveries_sent: number
  deliveries_failed: number
  retried: number
  errors: string[]
}

function newResult(mode: AlertMode, now: Date): AlertRunResult {
  return { mode, at: now.toISOString(), created: 0, deduped: 0, deliveries_sent: 0, deliveries_failed: 0, retried: 0, errors: [] }
}

function count(result: AlertRunResult, deliveries: DeliveryOutcome[]) {
  for (const d of deliveries) d.ok ? result.deliveries_sent++ : result.deliveries_failed++
}

async function rpcRows(db: Any, fn: string, args: Record<string, unknown>): Promise<Any[]> {
  const { data, error } = await db.rpc(fn, args)
  if (error) throw new Error(`${fn}: ${error.message}`)
  return (data ?? []) as Any[]
}

async function raise(db: Any, result: AlertRunResult, draft: AlertDraft, deps: ChannelDeps) {
  try {
    const r = await deliverAlert(db, draft, deps)
    if (!r.alertId) {
      result.deduped++
      return
    }
    result.created++
    count(result, r.deliveries)
  } catch (e) {
    result.errors.push(`${draft.kind}/${draft.dedupeKey}: ${(e as Error).message}`)
  }
}

async function rule(result: AlertRunResult, name: string, fn: () => Promise<void>) {
  try {
    await fn()
  } catch (e) {
    result.errors.push(`${name}: ${(e as Error).message}`)
  }
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const hhmm = (iso: string) => new Date(iso).toISOString().slice(11, 16)
const testMode = (mode: string | null | undefined) => (mode === "test" ? " (test mode)" : "")
/** "stripe_signature" → "stripe"; "razorpay_webhook" → "razorpay". */
export const providerOf = (code: string) => code.replace(/_(signature|webhook)$/, "")

function breakdown(label: string, m: Record<string, number> | null | undefined): string | null {
  const entries = Object.entries(m ?? {}).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  return entries.length ? `${label}: ${entries.map(([k, v]) => `${k} ${v}`).join(", ")}` : null
}

// ── Drafts (pure: one row in, one alert out) ────────────────────────────────────────────────────────────

export function paidNotGrantedDraft(r: Any, now: Date): AlertDraft {
  const what = r.plan ? `${r.plan} via ${r.provider}` : `a ${r.provider} purchase`
  return {
    tenantId: r.tenant_id,
    kind: "paid_not_granted",
    severity: "critical",
    dedupeKey: r.attempt_id,
    title: `Paid but not granted — ${what}${testMode(r.mode)}`,
    body: [
      `The provider reported a payment for attempt ${r.attempt_id}${r.paid_at ? ` at ${new Date(r.paid_at).toISOString()}` : ""}, ` +
      `but no entitlement was written. The buyer has paid and has no access — grant it or refund the payment.`,
      r.error_message ? `Detail: ${r.error_message}` : null,
    ].filter(Boolean).join("\n"),
    payload: {
      attempt_id: r.attempt_id, provider: r.provider, mode: r.mode, plan: r.plan, correlation: r.correlation,
      error_code: r.error_code, paid_at: r.paid_at, flagged_at: r.flagged_at,
    },
    stage: "entitlement",
    code: r.error_code ?? null,
    correlation: r.correlation ?? null,
    at: now,
  }
}

export function webhookFailureDraft(r: Any, now: Date): AlertDraft {
  const sig = r.kind === "webhook_sig_fail"
  const provider = providerOf(sig ? r.group_key : r.error_class)
  const n = plural(r.failures, `${provider} webhook`)
  return {
    tenantId: r.tenant_id,
    kind: sig ? "webhook_sig_fail" : "webhook_proc_fail",
    severity: "critical",
    dedupeKey: r.group_key,
    title: sig ? `Webhook signature check failing — ${provider}` : `Webhook processing failing — ${provider}`,
    body: [
      sig
        ? `${n} refused in the last ${WEBHOOK_WINDOW_MINUTES} minutes because the signature did not verify. The webhook ` +
          `secret saved in PayCraft does not match the one at ${provider}: buyers are charged but PayCraft cannot grant them.`
        : `${n} could not be processed in the last ${WEBHOOK_WINDOW_MINUTES} minutes (${plural(r.attempts, "attempt")} affected). ` +
          `Purchases may be paid without access until this is fixed.`,
      r.error_codes?.length ? `Codes: ${r.error_codes.join(", ")}` : null,
      r.last_message ? `Last error: ${r.last_message}` : null,
    ].filter(Boolean).join("\n"),
    payload: {
      provider, error_class: r.error_class, error_codes: r.error_codes, failures: r.failures, attempts: r.attempts,
      first_at: r.first_at, last_at: r.last_at, sample_attempt_ids: r.sample_attempt_ids,
    },
    stage: "webhook",
    code: (r.error_codes?.[0] as string | undefined) ?? null,
    at: now,
  }
}

export function spikeDraft(r: Any, now: Date): AlertDraft {
  const rate = Number(r.baseline_rate_per_hour)
  return {
    tenantId: r.tenant_id,
    kind: "failure_rate_spike",
    severity: "critical",
    dedupeKey: r.stage,
    title: `Failure spike at the ${r.stage} stage — ${plural(r.failures, "failure")} in the last hour`,
    body: [
      `${plural(r.failures, "purchase-attempt failure")} at the ${r.stage} stage between ${hhmm(r.window_start)} and ` +
      `${hhmm(r.window_end)} UTC, against a 7-day average of ${rate.toFixed(2)} an hour.`,
      r.top_error_classes?.length ? `Most recent: ${r.top_error_classes.join(", ")}` : null,
    ].filter(Boolean).join("\n"),
    payload: {
      stage: r.stage, failures: r.failures, baseline_failures: r.baseline_failures, baseline_rate_per_hour: rate,
      window_start: r.window_start, window_end: r.window_end, top_error_classes: r.top_error_classes,
    },
    stage: r.stage,
    at: now,
  }
}

export function digestDraft(kind: "abandon_digest" | "decline_digest", r: Any, now: Date): AlertDraft {
  const noun = kind === "abandon_digest" ? plural(r.count, "checkout") + " abandoned" : plural(r.count, "payment") + " declined"
  return {
    tenantId: r.tenant_id,
    kind,
    severity: "digest",
    dedupeKey: `hour-${new Date(r.window_start).toISOString().slice(0, 13)}`,
    title: `${noun} between ${hhmm(r.window_start)} and ${hhmm(r.window_end)} UTC`,
    body: [breakdown("By provider", r.by_provider), breakdown("By plan", r.by_plan), breakdown("Reasons", r.top_codes)]
      .filter(Boolean).join("\n"),
    payload: {
      count: r.count, window_start: r.window_start, window_end: r.window_end,
      by_provider: r.by_provider, by_plan: r.by_plan, top_codes: r.top_codes,
    },
    at: now,
  }
}

// ── Runs ────────────────────────────────────────────────────────────────────────────────────────────────

async function retryInto(db: Any, result: AlertRunResult, deps: ChannelDeps) {
  await rule(result, "retry", async () => {
    const retried = await retryDueDeliveries(db, deps)
    result.retried += retried.length
    count(result, retried)
  })
}

/** The critical rules, then due retries. */
export async function runCritical(db: Any, now: Date, deps: ChannelDeps = {}): Promise<AlertRunResult> {
  const d: ChannelDeps = { ...deps, now: () => now }
  const result = newResult("critical", now)
  const iso = now.toISOString()
  await rule(result, "paid_not_granted", async () => {
    for (const r of await rpcRows(db, "attempt_alert_paid_not_granted", { p_now: iso, p_lookback_minutes: PAID_NOT_GRANTED_LOOKBACK_MINUTES })) {
      await raise(db, result, paidNotGrantedDraft(r, now), d)
    }
  })
  await rule(result, "webhook_failures", async () => {
    for (const r of await rpcRows(db, "attempt_alert_webhook_failures", { p_now: iso, p_window_minutes: WEBHOOK_WINDOW_MINUTES })) {
      await raise(db, result, webhookFailureDraft(r, now), d)
    }
  })
  await rule(result, "failure_rate_spike", async () => {
    for (
      const r of await rpcRows(db, "attempt_failure_spikes_current_hour", {
        p_now: iso,
        p_min_failures: SPIKE_MIN_FAILURES,
        p_multiplier: SPIKE_MULTIPLIER,
      })
    ) {
      await raise(db, result, spikeDraft(r, now), d)
    }
  })
  await retryInto(db, result, d)
  return result
}

/** The hourly abandon + decline digests of the previous whole UTC hour, then due retries. */
export async function runDigest(db: Any, now: Date, deps: ChannelDeps = {}): Promise<AlertRunResult> {
  const d: ChannelDeps = { ...deps, now: () => now }
  const result = newResult("digest", now)
  const iso = now.toISOString()
  await rule(result, "abandon_digest", async () => {
    for (const r of await rpcRows(db, "attempt_hourly_abandon_summary", { p_now: iso })) {
      if (r.count > 0) await raise(db, result, digestDraft("abandon_digest", r, now), d)
    }
  })
  await rule(result, "decline_digest", async () => {
    for (const r of await rpcRows(db, "attempt_hourly_decline_summary", { p_now: iso })) {
      if (r.count > 0) await raise(db, result, digestDraft("decline_digest", r, now), d)
    }
  })
  await retryInto(db, result, d)
  return result
}

/** Only the due retries. */
export async function runRetry(db: Any, now: Date, deps: ChannelDeps = {}): Promise<AlertRunResult> {
  const result = newResult("retry", now)
  await retryInto(db, result, { ...deps, now: () => now })
  return result
}

/**
 * The dashboard's "Send test" (Settings ▸ Alert channels): a channel_test alert to one channel, or every
 * enabled one when [channel] is null. Never deduped (keyed by the instant) and never subject to a kind toggle.
 */
export async function sendChannelTest(
  db: Any,
  tenantId: string,
  channel: Channel | null,
  now: Date,
  deps: ChannelDeps = {},
): Promise<{ alertId: string; deliveries: DeliveryOutcome[] }> {
  const draft: AlertDraft = {
    tenantId,
    kind: "channel_test",
    severity: "digest",
    dedupeKey: `test-${now.toISOString()}`,
    title: "Test alert",
    body: "This is a test of your PayCraft alert channels. Real alerts arrive here when a purchase attempt needs attention.",
    payload: { test: true, channel },
    at: now,
  }
  const id = await recordAlert(db, draft, now)
  if (!id) throw new Error("channel_test not recorded")
  const deliveries = await dispatchAlert(db, {
    id, tenant_id: tenantId, kind: draft.kind, severity: draft.severity, title: draft.title, body: draft.body,
    body_html: null, payload: draft.payload ?? {}, created_at: now.toISOString(),
  }, { ...deps, now: () => now }, channel ? [channel] : CHANNELS)
  return { alertId: id, deliveries }
}
