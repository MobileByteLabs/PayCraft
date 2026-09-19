import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { DRIFT_DETECTORS, type DriftFinding } from "@/lib/drift-detectors"
import { logRequest } from "@/lib/request-log"

/**
 * GET /api/sync/drift — what has actually diverged.
 *
 * Reconcile, not drain. The detectors read real provider state, so the count reflects reality
 * rather than whatever was last flagged. On cappy, a flag-drain would have reported all-green while
 * the paywall row did not exist and Razorpay had zero payment links.
 *
 * SEQUENTIAL fan-out, not Promise.all. Every detector issues provider reads, and a dashboard the
 * operator can reload at will would turn a parallel burst into a rate-limit incident — Stripe
 * documents ~100 req/s and Razorpay a far tighter live ceiling. Sequential keeps the worst case a
 * slow refresh instead of a 429 storm.
 *
 * CACHED for 90s per tenant. Without it, an operator watching the badge re-reads every provider on
 * every render, and the cost of looking becomes the reason nobody looks.
 */

interface CacheEntry { at: number; findings: DriftFinding[] }
const CACHE = new Map<string, CacheEntry>()
const TTL_MS = 90_000

export async function GET(req: Request) {
  const supabase = createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) {
    // Logged, not silently rejected: an unauthenticated call is the one you most need a record of,
    // and an empty log during a 401 storm looks identical to no traffic at all.
    await logRequest(supabase, {
      route: "/api/sync/drift",
      method: "GET",
      status: 401,
      error: "not_authenticated",
    })
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }

  const url = new URL(req.url)
  const tenantId = url.searchParams.get("tenant_id")
  if (!tenantId) return NextResponse.json({ error: "tenant_id is required" }, { status: 400 })
  const force = url.searchParams.get("force") === "1"

  const hit = CACHE.get(tenantId)
  if (!force && hit && Date.now() - hit.at < TTL_MS) {
    // Log the CACHE HIT explicitly. A cached report is indistinguishable from a fresh one in the
    // UI, so "I fixed it and the banner still says the same thing" has two very different causes —
    // the fix did not work, or the reader never re-ran. Without this line, telling them apart means
    // guessing.
    await logRequest(supabase, {
      route: "/api/sync/drift",
      method: "GET",
      tenantId,
      status: 200,
      params: { force },
      result: { cached: true, cached_at: new Date(hit.at).toISOString(), age_ms: Date.now() - hit.at, count: hit.findings.length },
    })
    return NextResponse.json({
      findings: hit.findings,
      count: hit.findings.length,
      cached_at: new Date(hit.at).toISOString(),
    })
  }

  const findings: DriftFinding[] = []
  const errors: string[] = []
  for (const detect of DRIFT_DETECTORS) {
    try {
      findings.push(...(await detect(supabase, tenantId)))
    } catch (e) {
      // One unreachable provider must not blank the whole report — the other four classes are still
      // worth surfacing, and a silent empty result would read as "nothing wrong".
      errors.push(e instanceof Error ? e.message : String(e))
    }
  }

  CACHE.set(tenantId, { at: Date.now(), findings })
  await logRequest(supabase, {
    route: "/api/sync/drift",
    method: "GET",
    tenantId,
    status: 200,
    params: { force },
    result: { cached: false, count: findings.length, kinds: findings.map((f) => f.kind), detector_errors: errors },
  })
  return NextResponse.json({
    findings,
    count: findings.length,
    cached_at: null,
    partial: errors.length > 0 ? errors : undefined,
  })
}
