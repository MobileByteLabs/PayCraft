import { NextResponse } from "next/server"
import { withApiKey } from "@/lib/api-v1-helpers"
import { funnelResponse } from "@/lib/attempt-api"
export const dynamic = "force-dynamic"

/**
 * GET /v1/funnel — the paywall funnel (paywall_view → plan_select → checkout_start → purchase_success) by
 * distinct buyers, with the per-country and per-provider splits; the Analytics page's lib/funnel.ts.
 * `since` / `until` (default the last 30 days) capped at the plan's retention; `mode` = live (default) | test.
 */
export async function GET(req: Request) {
  return withApiKey(req, "subscribers:read", async (ctx) =>
    (await funnelResponse(ctx.admin, ctx.tenantId, new URL(req.url))) as NextResponse)
}
