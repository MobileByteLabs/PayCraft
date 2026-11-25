// supabase/functions/attempt-stitch/index.ts
//
// POST /functions/v1/attempt-stitch[?now=ISO] — the purchase-attempt stitcher (paycraft-attempt-observability
// D1 / D7; logic in stitch.ts): labels attempts old writers recorded without an attempt id as
// `correlation = inferred` + `match_rule` (never touching an exact attempt), flags provider-paid-but-not-
// granted after 10 minutes, and times out checkouts nothing came back from.
//
// Scheduled by pg_cron every 5 minutes with the service-role key (migration 211, `paycraft_attempt_stitch`).
// After the stitch, the same run evaluates the CRITICAL owner-alert rules (attempt-alerts/engine.ts) on the
// same clock, so a paid_not_granted the stitch just flagged reaches the owner in this tick; an alert failure
// is reported in `alerts.errors` and never fails the stitch.
// Any other caller is refused: `?now=` moves the clock the timeouts are measured on, so only the service role
// — the cron job, or an operator / test harness holding that key — may run it. 200 { ok, at, stitched,
// unmatched, paid_not_granted, abandoned, alerts } · 400 bad `now` · 401 not the service role · 500 with the error.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.1"
import { runCritical } from "../attempt-alerts/engine.ts"
import { parseStitchClock, stitchOnce } from "./stitch.ts"

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

/** The gateway has verified the JWT; this checks it is the service role, not the public anon key. */
function isServiceRole(req: Request): boolean {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "")
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")))
    return payload?.role === "service_role"
  } catch {
    return false
  }
}

export async function handleAttemptStitch(req: Request): Promise<Response> {
  if (req.method !== "POST" && req.method !== "GET") return json(405, { error: "method_not_allowed" })
  if (!isServiceRole(req)) return json(401, { error: "service_role_required" })
  const now = parseStitchClock(new URL(req.url).searchParams.get("now"), new Date())
  if (!now) return json(400, { error: "bad_now", detail: "now must be an ISO-8601 instant" })
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  try {
    const result = await stitchOnce(db, now)
    const alerts = await runCritical(db, now).catch((e) => ({ errors: [(e as Error).message] }))
    console.log(`[attempt-stitch] at=${now.toISOString()} ${JSON.stringify(result)} alerts=${JSON.stringify(alerts)}`)
    return json(200, { ok: true, at: now.toISOString(), ...result, alerts })
  } catch (e) {
    console.error("[attempt-stitch] failed:", (e as Error).message)
    return json(500, { error: (e as Error).message })
  }
}

// CONFIG_SKIP_SERVE mirrors the /config test harness: importing this module must not bind a port.
if (!Deno.env.get("CONFIG_SKIP_SERVE")) {
  Deno.serve(handleAttemptStitch)
}
