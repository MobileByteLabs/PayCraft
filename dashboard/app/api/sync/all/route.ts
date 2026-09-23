import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { logRequest } from "@/lib/request-log"
import { runSyncDrain } from "@/lib/sync-drain"

/**
 * POST /api/sync/all — drain everything that diverged.
 *
 * This BULK-WRITES to live providers, so it is gated on a count the caller must have seen. The
 * client reads /api/sync/drift, shows the operator N findings, and echoes N back as `confirm_count`.
 * A mismatch means the world changed between looking and acting — which is exactly when a bulk write
 * to a billing provider should stop and ask again rather than proceed on stale intent.
 *
 * The shape is borrowed from provider-connections-manager's shared-credential delete, which returns
 * a 409 carrying the count so a refusal reads as an instruction rather than a wall.
 */

export async function POST(req: Request) {
  const supabase = createClient()
  const { data: auth } = await supabase.auth.getUser()
  if (!auth?.user) {
    // Logged, not silently rejected: an unauthenticated call is the one you most need a record of,
    // and an empty log during a 401 storm looks identical to no traffic at all.
    await logRequest(supabase, {
      route: "/api/sync/all",
      method: "POST",
      status: 401,
      error: "not_authenticated",
    })
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as {
    tenant_id?: string
    confirm_count?: number
  }
  if (!body.tenant_id) return NextResponse.json({ error: "tenant_id is required" }, { status: 400 })

  return runSyncDrain(supabase, body.tenant_id, body.confirm_count, "/api/sync/all")
}
