import { NextResponse } from "next/server"
import { withApiKey } from "@/lib/api-v1-helpers"
import { analyticsResponse } from "@/lib/attempt-api"
import { paycraftGa4Account } from "@/lib/ga4"
export const dynamic = "force-dynamic"

/**
 * GET /v1/analytics — the joined Analytics report: PayCraft's provider-truth funnel, Payment health and the app's GA4
 * segments (its own streams only) under one filter set (`days`, `platform`, `country`, `app_version`, `plan`). What
 * /idea-paycraft-analytics and the `paycraft` MCP audit; the dashboard's Analytics page renders the same shape.
 */
export async function GET(req: Request) {
  return withApiKey(req, "subscribers:read", async (ctx) =>
    (await analyticsResponse(ctx.admin, ctx.tenantId, new URL(req.url), { account: paycraftGa4Account() })) as NextResponse)
}
