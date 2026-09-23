import { listResource } from "@/lib/api-v1-helpers"
export const dynamic = "force-dynamic"

/**
 * GET /v1/sync/events — per-provider events for a sync run.
 *
 * Pass `?run_id=` from a sync response to see what happened provider by provider. This is where a
 * failure explains itself: the summary says a provider failed, these rows say why.
 */
export async function GET(req: Request) {
  return listResource(req, "products:read", {
    table: "sync_events",
    columns: "id, run_id, product_id, product_name, provider, phase, status, message, created_at",
    orderBy: { column: "created_at", ascending: true },
    filters: (q) => ({ run_id: q.get("run_id"), provider: q.get("provider"), status: q.get("status") }),
  })
}
