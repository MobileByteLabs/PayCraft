// supabase/functions/events/index.ts
//
// Paywall events ingest — the only door into `paywall_events` (paycraft-paywall-analytics, GOAL D1).
//
// POST /functions/v1/events?apiKey=pk_…
// { "apiKey": "pk_…", "deviceRef": "<per-app device fingerprint>", "deviceToken": "srv_…"?,
//   "events": [{ "name": "paycraft_paywall_view", "step": "paywall", "platform": "android",
//                "trigger"?, "sku"?, "currency"?, "provider"?, "reason"?, "experiment"?, "variant"?,
//                "attempt_id"?, "failure"?: { "stage", "error_class", "error_code"?, "error_message"? },
//                "app_version"?, "app_build"?, "os_version"?,
//                "at": <epoch ms> }],
//   "attempt_id"?,                        ← the batch's attempt, for events that carry none of their own
//   "app_version"?, "app_build"?, "os_version"?, "appVersion"? }  ← batch defaults for the release dimensions
//
// 202 { stored: N } · 400 unknown_event / bad_event / bad_body · 401 invalid_apiKey · 413 too_large · 429
//
// What this function guarantees, because the dashboard funnel rests on it:
//   · Only catalog names (EVENT_CATALOG, generated from PayCraftEvent.kt) — one bad event refuses the batch.
//   · No personal data: the buyer is stored as sha256(tenant_id || email), resolved here from the device
//     token; the email itself never leaves `registered_devices`.
//   · The country is the edge's IP-geo when there is one (`country_source = 'server'`); else the region the device
//     reported for the event, or its Accept-Language region (`'device'`) — migration 215. Supabase's edge sends no
//     geo header, so without the device fallback every row's country was null.
//   · One device cannot flood the table (token bucket per tenant + device).
//   · Attempts (migration 210): an event's `attempt_id` (the SDK's purchase-attempt id) is stamped on its
//     paywall_events row and the event is appended to that attempt's timeline (`attempt_events`, stage
//     `sdk`); a `failure` lands there with its stage, class, code and a sanitised message ≤ 200 chars (D6).
//     A malformed id or failure refuses the batch, like any other bad field.
//   · Release dimensions (migration 223): app_version (≤ 40), app_build (int ≥ 0), os_version (≤ 20), per event or
//     per batch (events/release-dims.ts). An invalid one is dropped — never a reason to refuse the event.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.1"
import { preflight, withCors } from "../_shared/cors.ts"
import { EVENT_CATALOG } from "../_shared/event-catalog.ts"
import { eventCountry } from "../_shared/geo.ts"
import { releaseDims } from "./release-dims.ts"
import { RateLimitError, rateLimitResponse, requireRateLimit } from "../_shared/rate-limit.ts"
import {
  appendEvents,
  ATTEMPT_STAGES,
  attemptBestEffort,
  type AttemptFailure,
  type AttemptStage,
  normaliseAttemptId,
  sanitiseCode,
  sanitiseMessage,
} from "../_shared/payment-attempts.ts"

const MAX_BYTES = 32_768
const MAX_EVENTS = 50
const PLATFORMS = new Set(["android", "ios", "web", "desktop"])
const STEP = /^[a-z][a-z_]{0,30}$/
const CURRENCY = /^[A-Z]{3}$/
// The A/B experiment the device was in (migration 206) — the same patterns the columns CHECK.
const EXPERIMENT = /^[a-z0-9][a-z0-9-]{1,47}$/
const VARIANT = /^[a-z0-9][a-z0-9-]{0,31}$/
// An event dated far from now is a broken clock or a replay, not a funnel step.
const MAX_SKEW_MS = 7 * 24 * 3600 * 1000

type InEvent = {
  name?: unknown; step?: unknown; platform?: unknown; trigger?: unknown; sku?: unknown
  currency?: unknown; provider?: unknown; reason?: unknown; at?: unknown
  experiment?: unknown; variant?: unknown
  attempt_id?: unknown; failure?: unknown
  app_version?: unknown; app_build?: unknown; os_version?: unknown
  /** The device's region (alpha-2) — stored only when the edge has no geo (migration 215). */
  deviceCountry?: unknown
}

/** The failure an SDK event reports, validated: a known stage and a class are required (D6). */
function parseFailure(v: unknown): AttemptFailure | null | "bad" {
  if (v === undefined || v === null) return null
  if (typeof v !== "object" || Array.isArray(v)) return "bad"
  const f = v as Record<string, unknown>
  const stage = typeof f.stage === "string" && (ATTEMPT_STAGES as readonly string[]).includes(f.stage)
    ? f.stage as AttemptStage
    : null
  const errorClass = typeof f.error_class === "string" ? sanitiseCode(f.error_class) : null
  if (!stage || !errorClass) return "bad"
  const code = typeof f.error_code === "string" || typeof f.error_code === "number" ? f.error_code : null
  return {
    stage,
    error_class: errorClass,
    error_code: sanitiseCode(code),
    error_message: sanitiseMessage(typeof f.error_message === "string" ? f.error_message : null),
  }
}

const json = (status: number, body: unknown) =>
  withCors(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }))

const str = (v: unknown, max: number): string | null =>
  typeof v === "string" && v.length > 0 ? v.slice(0, max) : null

/** A stable bucket 0..1023 for a device (FNV-1a) — bounded, so one row per bucket, not per device. */
function deviceBucket(ref: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < ref.length; i++) h = Math.imul(h ^ ref.charCodeAt(i), 0x01000193)
  return (h >>> 0) % 1024
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" })

  const raw = await req.text()
  if (new TextEncoder().encode(raw).length > MAX_BYTES) return json(413, { error: "too_large", max_bytes: MAX_BYTES })
  let body: { apiKey?: string; deviceRef?: string; deviceToken?: string; events?: InEvent[]; attempt_id?: unknown }
  try {
    body = JSON.parse(raw)
  } catch {
    return json(400, { error: "bad_body" })
  }
  const apiKey = body.apiKey ?? new URL(req.url).searchParams.get("apiKey") ?? ""
  if (!Array.isArray(body.events)) return json(400, { error: "bad_body", detail: "events must be an array" })
  if (body.events.length > MAX_EVENTS) return json(413, { error: "too_large", max_events: MAX_EVENTS })

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
  const { data: tenantId, error: resolveErr } = await supabase.rpc("resolve_tenant", { p_api_key: apiKey })
  if (resolveErr || !tenantId) return json(401, { error: "invalid_apiKey" })

  const deviceRef = str(body.deviceRef, 100)
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown"
  try {
    // 60-request burst, refilling 1/s, per tenant + device: an SDK sends a batch every few seconds at most.
    // rate_limit_check keys on the tenant UUID; the device goes in the bucket name, spread over 1024 buckets so
    // the limiter table stays bounded however many devices a tenant has.
    await requireRateLimit(supabase, tenantId, ip, `events:${deviceBucket(deviceRef ?? ip)}`, 60, 1)
  } catch (e) {
    if (e instanceof RateLimitError) return withCors(rateLimitResponse(e))
    throw e
  }

  // The batch-level attempt, for events that carry none of their own.
  const batchAttempt = normaliseAttemptId(body.attempt_id)
  if (body.attempt_id != null && !batchAttempt) return json(400, { error: "bad_body", detail: "attempt_id" })

  const now = Date.now()
  const rows = []
  // The attempt timeline rows these events produce — beside, not inside, the paywall_events rows.
  const timeline: Array<{ attemptId: string; event: string; failure: AttemptFailure | null; at: string }> = []
  for (const e of body.events) {
    const name = str(e?.name, 40)
    if (!name || !EVENT_CATALOG.has(name)) return json(400, { error: "unknown_event", name: e?.name ?? null })
    const step = str(e.step, 31)
    const platform = str(e.platform, 10)
    const at = typeof e.at === "number" ? e.at : NaN
    if (!step || !STEP.test(step) || !platform || !PLATFORMS.has(platform) || !Number.isFinite(at) || Math.abs(at - now) > MAX_SKEW_MS) {
      return json(400, { error: "bad_event", name })
    }
    const ownAttempt = normaliseAttemptId(e.attempt_id)
    if (e.attempt_id != null && !ownAttempt) return json(400, { error: "bad_event", name, detail: "attempt_id" })
    const attemptId = ownAttempt ?? batchAttempt
    const failure = parseFailure(e.failure)
    if (failure === "bad") return json(400, { error: "bad_event", name, detail: "failure" })
    if (failure && !attemptId) return json(400, { error: "bad_event", name, detail: "failure requires attempt_id" })
    const currency = str(e.currency, 3)
    const experiment = str(e.experiment, 48)
    const variant = str(e.variant, 32)
    const inExperiment = experiment !== null && variant !== null && EXPERIMENT.test(experiment) && VARIANT.test(variant)
    // The edge's geo wins; else the region this device reported for the event (migration 215, `country_source`).
    const { country, source: country_source } = eventCountry(req, str(e.deviceCountry, 8))
    rows.push({
      country, country_source,
      name, step, platform,
      trigger: str(e.trigger, 100), sku: str(e.sku, 100), provider: str(e.provider, 40), reason: str(e.reason, 100),
      currency: currency && CURRENCY.test(currency) ? currency : null,
      experiment: inExperiment ? experiment : null,
      variant: inExperiment ? variant : null,
      attempt_id: attemptId,
      ...releaseDims(e as Record<string, unknown>, body as Record<string, unknown>),
      occurred_at: new Date(at).toISOString(),
    })
    if (attemptId) timeline.push({ attemptId, event: name, failure, at: new Date(at).toISOString() })
  }
  if (rows.length === 0) return json(202, { stored: 0 })

  // The buyer, as a hash: the device token's account email never leaves registered_devices.
  let userRef: string | null = null
  const token = str(body.deviceToken, 200)
  if (token) {
    const { data: dev } = await supabase.from("registered_devices").select("email")
      .eq("device_token", token).eq("tenant_id", tenantId).maybeSingle()
    if (dev?.email) userRef = await sha256Hex(`${tenantId}:${String(dev.email).toLowerCase()}`)
  }

  // A beacon (sent as the page unloads) carries no headers, so the web SDK repeats the mode in the body.
  const mode = (req.headers.get("x-paycraft-mode") ?? (body as { mode?: string }).mode ?? "").toLowerCase() === "test"
    ? "test"
    : "live"
  const { error } = await supabase.from("paywall_events").insert(
    rows.map((r) => ({ ...r, tenant_id: tenantId, user_ref: userRef, device_ref: deviceRef, mode })),
  )
  if (error) return json(500, { error: "store_failed" })

  // The attempt timeline (one write through _shared/payment-attempts.ts). The funnel rows above are what this
  // request promised; a timeline write that fails is logged and the batch still counts as stored (a retry
  // would duplicate the funnel rows).
  if (timeline.length) {
    await attemptBestEffort(`events timeline (${timeline.length} rows)`, () =>
      appendEvents(supabase, tenantId, timeline.map((t) => ({
        attemptId: t.attemptId,
        stage: t.failure?.stage ?? "sdk",
        event: t.event,
        failure: t.failure,
        at: t.at,
      }))))
  }
  return json(202, { stored: rows.length })
})
