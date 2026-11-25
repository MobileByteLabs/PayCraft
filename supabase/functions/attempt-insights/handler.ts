// supabase/functions/attempt-insights/handler.ts
//
// POST /functions/v1/attempt-insights[?now=ISO][&tenant_id=UUID] — the weekly AI insight run (engine.ts).
// Called by 211's `paycraft_attempt_insights` pg_cron job (Monday 09:00 UTC) through attempt_insights_dispatch()
// (migration 212), or by an operator holding the service-role key: `now` moves the clock the "last ISO week" is
// measured on, `tenant_id` limits the run to one app.
//
// The model key is the org-level vault alias `mbs-claude-api-key-1`, set as the function secret
// ANTHROPIC_API_KEY (`supabase secrets set`). Without it the run refuses with 503 `anthropic_key_missing`
// BEFORE touching the database: nothing is reserved, nothing is spent, and the next weekly tick simply asks again
// — a missing key is an onboarding step, never a crash loop.
//
// 200 { ok: true, week, due, stored, delivered, spent_usd, skipped[], errors[] } · 400 bad now / tenant_id ·
// 401 not the service role · 405 · 500 { ok: false, … } when any tenant failed (the others still ran) ·
// 503 anthropic_key_missing.

import type { ChannelDeps } from "../_shared/alert-channels.ts"
import { type LlmClient, runInsights } from "./engine.ts"

// deno-lint-ignore no-explicit-any
type Any = any

export interface HandlerDeps {
  env: (name: string) => string | undefined
  /** The service-role database client. Built only after the request is authorised and the key is present. */
  db: () => Any
  /** The model client for this API key. */
  llm: (apiKey: string) => LlmClient
  channelDeps?: ChannelDeps
}

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

export async function handleAttemptInsights(req: Request, deps: HandlerDeps): Promise<Response> {
  if (req.method !== "POST" && req.method !== "GET") return json(405, { error: "method_not_allowed" })
  if (!isServiceRole(req)) return json(401, { error: "service_role_required" })

  const q = new URL(req.url).searchParams
  const rawNow = q.get("now")
  const now = rawNow ? new Date(Date.parse(rawNow)) : new Date()
  if (Number.isNaN(now.getTime())) return json(400, { error: "bad_now", detail: "now must be an ISO-8601 instant" })
  const tenantId = q.get("tenant_id")
  if (tenantId !== null && !UUID.test(tenantId)) return json(400, { error: "bad_tenant_id" })

  const apiKey = deps.env("ANTHROPIC_API_KEY")?.trim()
  if (!apiKey) {
    console.warn("[attempt-insights] ANTHROPIC_API_KEY is not set — weekly insights skipped, nothing spent")
    return json(503, {
      ok: false,
      error: "anthropic_key_missing",
      detail: "Set the function secret ANTHROPIC_API_KEY from the org vault alias mbs-claude-api-key-1 " +
        "(supabase secrets set). No insight was attempted.",
    })
  }

  try {
    const result = await runInsights(deps.db(), deps.llm(apiKey), { now, tenantId, channelDeps: deps.channelDeps })
    console.log(`[attempt-insights] ${JSON.stringify(result)}`)
    return json(result.errors.length ? 500 : 200, { ok: result.errors.length === 0, ...result })
  } catch (e) {
    console.error("[attempt-insights] failed:", (e as Error).message)
    return json(500, { ok: false, error: (e as Error).message })
  }
}
