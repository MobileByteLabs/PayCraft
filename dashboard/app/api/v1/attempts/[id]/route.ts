import { NextResponse } from "next/server"
import { withApiKey } from "@/lib/api-v1-helpers"
import { attemptResponse } from "@/lib/attempt-api"
export const dynamic = "force-dynamic"

/**
 * GET /v1/attempts/{id} — one attempt, by its row id or its attempt_id, with the full attempt_events timeline
 * (every stage transition; each failure's stage, class, code and message of at most 200 characters).
 * 404 when the attempt is not this key's tenant's — the id alone never reaches another app.
 */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return withApiKey(req, "subscribers:read", async (ctx) =>
    (await attemptResponse(ctx.admin, ctx.tenantId, params?.id)) as NextResponse)
}
