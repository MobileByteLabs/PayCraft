// supabase/functions/events/index.ts
//
// Paywall events ingest — the only door into `paywall_events` (paycraft-paywall-analytics, GOAL D1).
//
// POST /functions/v1/events?apiKey=pk_…
// { "apiKey": "pk_…", "deviceRef": "<per-app device fingerprint>", "deviceToken": "srv_…"?,
//   "events": [{ "name": "paycraft_paywall_view", "step": "paywall", "platform": "android",
//                "trigger"?, "sku"?, "currency"?, "provider"?, "reason"?, "at": <epoch ms> }] }
//
// 202 { stored: N } · 400 unknown_event / bad_event / bad_body · 401 invalid_apiKey · 413 too_large · 429
//
// What this function guarantees, because the dashboard funnel rests on it:
//   · Only catalog names (EVENT_CATALOG, generated from PayCraftEvent.kt) — one bad event refuses the batch.
//   · No personal data: the buyer is stored as sha256(tenant_id || email), resolved here from the device
//     token; the email itself never leaves `registered_devices`.
//   · The country is the SERVER's (edge geo / Accept-Language) — a client-sent country is ignored.
//   · One device cannot flood the table (token bucket per tenant + device).

import { serve } from "https://deno.land/std@0.208.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.1"
import { preflight, withCors } from "../_shared/cors.ts"
import { EVENT_CATALOG } from "../_shared/event-catalog.ts"
import { recordedCountry } from "../_shared/geo.ts"
import { RateLimitError, rateLimitResponse, requireRateLimit } from "../_shared/rate-limit.ts"

const MAX_BYTES = 32_768
const MAX_EVENTS = 50
const PLATFORMS = new Set(["android", "ios", "web", "desktop"])
const STEP = /^[a-z][a-z_]{0,30}$/
const CURRENCY = /^[A-Z]{3}$/
// An event dated far from now is a broken clock or a replay, not a funnel step.
const MAX_SKEW_MS = 7 * 24 * 3600 * 1000

type InEvent = {
  name?: unknown; step?: unknown; platform?: unknown; trigger?: unknown; sku?: unknown
  currency?: unknown; provider?: unknown; reason?: unknown; at?: unknown
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
  let body: { apiKey?: string; deviceRef?: string; deviceToken?: string; events?: InEvent[] }
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

  const now = Date.now()
  const rows = []
  for (const e of body.events) {
    const name = str(e?.name, 40)
    if (!name || !EVENT_CATALOG.has(name)) return json(400, { error: "unknown_event", name: e?.name ?? null })
    const step = str(e.step, 31)
    const platform = str(e.platform, 10)
    const at = typeof e.at === "number" ? e.at : NaN
    if (!step || !STEP.test(step) || !platform || !PLATFORMS.has(platform) || !Number.isFinite(at) || Math.abs(at - now) > MAX_SKEW_MS) {
      return json(400, { error: "bad_event", name })
    }
    const currency = str(e.currency, 3)
    rows.push({
      name, step, platform,
      trigger: str(e.trigger, 100), sku: str(e.sku, 100), provider: str(e.provider, 40), reason: str(e.reason, 100),
      currency: currency && CURRENCY.test(currency) ? currency : null,
      occurred_at: new Date(at).toISOString(),
    })
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
  const country = recordedCountry(req)
  const { error } = await supabase.from("paywall_events").insert(
    rows.map((r) => ({ ...r, tenant_id: tenantId, user_ref: userRef, device_ref: deviceRef, country, mode })),
  )
  if (error) return json(500, { error: "store_failed" })
  return json(202, { stored: rows.length })
})
