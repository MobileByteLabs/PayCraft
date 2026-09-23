import { NextResponse } from "next/server"
import { withApiKey } from "@/lib/api-v1-helpers"
import { queryFailed } from "@/lib/api-security"
export const dynamic = "force-dynamic"

/**
 * GET /v1/paywall — the paywall configuration the SDK renders from.
 *
 * Useful in CI as a snapshot: diff this between deploys and a paywall that changed without anyone
 * intending it shows up as a failing check rather than a customer complaint.
 */
export async function GET(req: Request) {
  return withApiKey(req, "paywall:read", async (ctx) => {
    const { data, error } = await ctx.admin
      .from("tenant_paywall")
      .select("*")
      .eq("tenant_id", ctx.tenantId)
      .maybeSingle()

    if (error) return queryFailed("v1/paywall", error) as NextResponse
    if (!data) {
      return NextResponse.json(
        { error: "not_found", detail: "no paywall configured for this tenant" },
        { status: 404 },
      )
    }
    return NextResponse.json(data)
  })
}
