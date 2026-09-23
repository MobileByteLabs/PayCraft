import { NextResponse } from "next/server"
import { requireApiKey, isFailure, auditApiAction } from "@/lib/api-key-auth"
import { bodyTooLarge, withSecurityHeaders } from "@/lib/api-security"
import { runSyncDrain } from "@/lib/sync-drain"
import { DRIFT_DETECTORS, type DriftFinding } from "@/lib/drift-detectors"

export const dynamic = "force-dynamic"

/**
 * GET  /api/v1/sync — the drift report (what a drain WOULD do). Read-only.
 * POST /api/v1/sync — run the drain.
 *
 * SAME BODY AS THE DASHBOARD. This delegates to `runSyncDrain`, the routine extracted from
 * POST /api/sync/all, so both callers do the identical thing. A second implementation of a routine
 * that bulk-writes to live payment providers is a bug with a delay fuse.
 *
 * THE CONFIRM GATE IS KEPT, DELIBERATELY.
 * The dashboard makes an operator read a count and echo it back, so a bulk write to a billing
 * provider cannot proceed on stale intent. It would have been easy to drop that for machines on the
 * grounds that nobody is looking — which is exactly backwards: nobody looking is when a mismatched
 * count matters most. A client GETs this route, reads `confirm_count`, and echoes it in the POST.
 * If the world changed in between, the POST 409s and the automation re-reads rather than draining a
 * set its operator never saw.
 */

export async function GET(req: Request) {
  const ctx = await requireApiKey(req, "products:read")
  if (isFailure(ctx)) return ctx.failed

  const findings: DriftFinding[] = []
  for (const detect of DRIFT_DETECTORS) {
    try {
      findings.push(...(await detect(ctx.admin as never, ctx.tenantId)))
    } catch (e) {
      // Same refusal as the drain: an unknown count is not a zero count.
      return withSecurityHeaders(
        NextResponse.json(
        {
          error: "drift_incomplete",
          detail: e instanceof Error ? e.message : "a provider was unreachable",
        },
        { status: 503 },
        ),
      )
    }
  }

  return withSecurityHeaders(
    NextResponse.json({
      tenant_id: ctx.tenantId,
      confirm_count: findings.length,
      findings: findings.map((f) => ({ kind: f.kind, subject: f.subject })),
    }),
  )
}

export async function POST(req: Request) {
  // Cheapest check first: refuse an oversized body before authenticating, before parsing, before
  // anything that costs more than reading one header.
  const oversized = bodyTooLarge(req)
  if (oversized) return oversized

  const ctx = await requireApiKey(req, "products:sync")
  if (isFailure(ctx)) return ctx.failed

  const body = (await req.json().catch(() => ({}))) as { confirm_count?: number }

  await auditApiAction(ctx, "sync.all.requested", `tenant:${ctx.tenantId}`, {
    confirm_count: body.confirm_count,
  })

  // ctx.tenantId, never a body field — a key issued for one tenant must not be able to name another.
  return withSecurityHeaders(
    await runSyncDrain(ctx.admin as never, ctx.tenantId, body.confirm_count, "/api/v1/sync"),
  )
}
