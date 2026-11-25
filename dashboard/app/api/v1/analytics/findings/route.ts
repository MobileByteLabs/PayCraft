import { NextResponse } from "next/server"
import { withApiKey } from "@/lib/api-v1-helpers"
import { findingsListResponse, findingsResolveResponse, findingsUpsertResponse } from "@/lib/attempt-api"
export const dynamic = "force-dynamic"

/**
 * /v1/analytics/findings — the AI audit's findings (migration 216), the queue /idea-paycraft-analytics drains.
 *   GET    list (open by default; `status=all|open|fixed|dismissed`)       subscribers:read
 *   POST   record a finding the command found (source `command`)          analytics:write
 *   PATCH  resolve one with what was done `{ id, status, note }`           analytics:write
 */
export async function GET(req: Request) {
  return withApiKey(req, "subscribers:read", async (ctx) =>
    (await findingsListResponse(ctx.admin, ctx.tenantId, new URL(req.url))) as NextResponse)
}

export async function POST(req: Request) {
  return withApiKey(req, "analytics:write", async (ctx) =>
    (await findingsUpsertResponse(ctx.admin, ctx.tenantId, req)) as NextResponse)
}

export async function PATCH(req: Request) {
  return withApiKey(req, "analytics:write", async (ctx) =>
    (await findingsResolveResponse(ctx.admin, ctx.tenantId, req)) as NextResponse)
}
