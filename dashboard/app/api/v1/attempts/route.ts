import { NextResponse } from "next/server"
import { withApiKey } from "@/lib/api-v1-helpers"
import { listAttemptsResponse } from "@/lib/attempt-api"
export const dynamic = "force-dynamic"

/**
 * GET /v1/attempts — every purchase attempt (migration 210) with its current state, failure stage, provider and
 * country (212's payment_attempts_geo), newest first.
 *
 * Filters: state, stage, provider, country (ISO alpha-2), mode, correlation (exact | inferred), since / until
 * (on started_at), user (the buyer's email — matched on the attempt's hash, never stored or returned), plus
 * limit / offset. The rows carry no buyer identity: use /v1/subscribers for that.
 */
export async function GET(req: Request) {
  return withApiKey(req, "subscribers:read", async (ctx) =>
    (await listAttemptsResponse(ctx.admin, ctx.tenantId, new URL(req.url))) as NextResponse)
}
