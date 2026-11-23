// supabase/functions/attribution-ids/index.ts
//
// The SDK's ad/analytics ids for this device (migration 208) — what the attribution forwarder
// (_shared/attribution.ts) identifies the buyer by when it sends a purchase / renewal / refund to GA4 or
// AppsFlyer. `PayCraft.setAttributionIds(...)` posts here once the device is registered.
//
// POST /functions/v1/attribution-ids?apiKey=pk_…
// { "apiKey"?, "deviceToken", "firebaseAppInstanceId"?, "appsFlyerId"? }
// 200 { ok: true } · 400 bad_body · 401 invalid_apiKey / unknown_device · 429
//
// An omitted id keeps what is stored; the device is the registered_devices row the token belongs to, in
// the key's tenant — a token from another app is refused.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.1"
import { preflight, withCors } from "../_shared/cors.ts"
import { RateLimitError, rateLimitResponse, requireRateLimit } from "../_shared/rate-limit.ts"

const ID = /^[A-Za-z0-9._:-]{1,64}$/

const json = (status: number, body: unknown) =>
  withCors(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }))

serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" })

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json(400, { error: "bad_body" })
  const apiKey = (typeof body.apiKey === "string" ? body.apiKey : null) ?? new URL(req.url).searchParams.get("apiKey") ?? ""
  const token = typeof body.deviceToken === "string" ? body.deviceToken.slice(0, 200) : ""
  const ids: Record<string, string> = {}
  for (const [field, column] of [["firebaseAppInstanceId", "firebase_app_instance_id"], ["appsFlyerId", "appsflyer_id"]]) {
    const v = body[field]
    if (v === undefined || v === null || v === "") continue
    if (typeof v !== "string" || !ID.test(v)) return json(400, { error: "bad_body" })
    ids[column] = v
  }
  if (!token || Object.keys(ids).length === 0) return json(400, { error: "bad_body" })

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
  const { data: tenantId, error: resolveErr } = await supabase.rpc("resolve_tenant", { p_api_key: apiKey })
  if (resolveErr || !tenantId) return json(401, { error: "invalid_apiKey" })

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown"
  try {
    await requireRateLimit(supabase, tenantId, ip, "attribution-ids", 30, 0.5)
  } catch (e) {
    if (e instanceof RateLimitError) return withCors(rateLimitResponse(e))
    throw e
  }

  const { data: dev } = await supabase.from("registered_devices").select("id")
    .eq("device_token", token).eq("tenant_id", tenantId).is("revoked_at", null).maybeSingle()
  if (!dev) return json(401, { error: "unknown_device" })

  // Only the columns sent are written: PostgREST's upsert updates just the payload's columns.
  const { error } = await supabase.from("device_attribution_ids").upsert(
    { device_row_id: dev.id, tenant_id: tenantId, ...ids, updated_at: new Date().toISOString() },
    { onConflict: "device_row_id" },
  )
  if (error) {
    console.error(`attribution-ids: upsert failed: ${error.message}`)
    return json(500, { error: "store_failed" })
  }
  return json(200, { ok: true })
})
