import { NextResponse } from "next/server"
import { withApiKey } from "@/lib/api-v1-helpers"
import { computeStoreReadiness } from "@/lib/store-readiness"
export const dynamic = "force-dynamic"

/**
 * GET /v1/products/store-readiness — are the native-store products SELLABLE, asked of the stores.
 * Same payload as the dashboard's /api/products/store-readiness: both call computeStoreReadiness.
 * 200 even when not ready — "not ready" is an answer, not a transport failure.
 */
export async function GET(req: Request) {
  return withApiKey(req, "products:read", async (ctx) =>
    NextResponse.json({ tenant_id: ctx.tenantId, ...(await computeStoreReadiness(ctx.admin, ctx.tenantId)) }),
  )
}
