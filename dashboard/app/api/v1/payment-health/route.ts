import { NextResponse } from "next/server"
import { withApiKey } from "@/lib/api-v1-helpers"
import { paymentHealthResponse } from "@/lib/attempt-api"
export const dynamic = "force-dynamic"

/**
 * GET /v1/payment-health — where purchase attempts fail and where buyers give up: failure rate by stage,
 * provider and country, abandon rate by step, paid-not-granted count and resume-reminder reach. The same
 * numbers as the dashboard's Analytics ▸ Payment health (lib/payment-health.ts).
 *
 * `since` / `until` (default the last 30 days) are capped at the plan's analytics retention; the response's
 * `window.capped` says when that happened. `mode` = live (default) | test.
 */
export async function GET(req: Request) {
  return withApiKey(req, "subscribers:read", async (ctx) =>
    (await paymentHealthResponse(ctx.admin, ctx.tenantId, new URL(req.url))) as NextResponse)
}
