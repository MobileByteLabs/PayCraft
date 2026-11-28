// supabase/functions/attempt-alerts/index.ts
//
// POST /functions/v1/attempt-alerts?mode=critical|digest|retry|test[&now=ISO][&tenant_id=UUID&channel=C]
// — the owner alert engine for purchase attempts (paycraft-attempt-observability D8 / D9; rules in engine.ts,
// delivery in _shared/alert-channels.ts):
//
//   critical  paid_not_granted · webhook signature / processing failures · failure-rate spike · release_regression ·
//             sign_in_failing · paywall_silent (224), then due
//             retries. attempt-stitch runs the same rules in-process after every 5-minute stitch.
//   digest    the abandon + decline digests of the previous UTC hour, then due retries (hourly cron, 211).
//   retry     only the deliveries whose next_retry_at has come.
//   test      one channel_test alert for tenant_id, to `channel` or every enabled channel (dashboard "Send test").
//
// Service role only (the cron job, the dashboard server, an operator or test harness holding the key): `now`
// moves the clock the rules are measured on, and every mode sends to the tenant's channels.
// 200 { ok: true, … } · 400 bad mode / now / tenant_id / channel · 401 not the service role · 405 · 500 { ok:
// false, errors } when any rule failed (the others still ran).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.1"
import { type Channel, CHANNELS } from "../_shared/alert-channels.ts"
import { type AlertMode, runCritical, runDigest, runRetry, sendChannelTest } from "./engine.ts"

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

export async function handleAttemptAlerts(req: Request): Promise<Response> {
  if (req.method !== "POST" && req.method !== "GET") return json(405, { error: "method_not_allowed" })
  if (!isServiceRole(req)) return json(401, { error: "service_role_required" })
  const q = new URL(req.url).searchParams
  const mode = (q.get("mode") ?? "critical") as AlertMode | "test"
  if (!["critical", "digest", "retry", "test"].includes(mode)) return json(400, { error: "bad_mode", detail: "critical | digest | retry | test" })
  const rawNow = q.get("now")
  const now = rawNow ? new Date(Date.parse(rawNow)) : new Date()
  if (Number.isNaN(now.getTime())) return json(400, { error: "bad_now", detail: "now must be an ISO-8601 instant" })

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  try {
    if (mode === "test") {
      const tenantId = q.get("tenant_id") ?? ""
      if (!UUID.test(tenantId)) return json(400, { error: "bad_tenant_id" })
      const channel = q.get("channel")
      if (channel !== null && !CHANNELS.includes(channel as Channel)) return json(400, { error: "bad_channel", detail: CHANNELS.join(" | ") })
      const r = await sendChannelTest(db, tenantId, channel as Channel | null, now)
      return json(200, { ok: true, at: now.toISOString(), alert_id: r.alertId, deliveries: r.deliveries })
    }
    const result = mode === "digest" ? await runDigest(db, now) : mode === "retry" ? await runRetry(db, now) : await runCritical(db, now)
    console.log(`[attempt-alerts] ${JSON.stringify(result)}`)
    return json(result.errors.length ? 500 : 200, { ok: result.errors.length === 0, ...result })
  } catch (e) {
    console.error("[attempt-alerts] failed:", (e as Error).message)
    return json(500, { ok: false, error: (e as Error).message })
  }
}

// CONFIG_SKIP_SERVE mirrors the /config test harness: importing this module must not bind a port.
if (!Deno.env.get("CONFIG_SKIP_SERVE")) {
  Deno.serve(handleAttemptAlerts)
}
