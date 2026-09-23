import { listResource } from "@/lib/api-v1-helpers"
export const dynamic = "force-dynamic"

/**
 * GET /v1/webhooks — inbound webhook deliveries.
 *
 * `payload_redacted` is the stored form; the raw provider payload is never retained, so this cannot
 * leak card or customer detail. Filter by `status=failed` to answer "did we drop anything?" — the
 * question that matters after a provider incident.
 */
export async function GET(req: Request) {
  return listResource(req, "webhooks:read", {
    table: "webhook_logs",
    columns:
      "id, provider, event_type, status, error_message, processing_ms, mode, created_at, payload_redacted",
    orderBy: { column: "created_at", ascending: false },
    filters: (q) => ({
      provider: q.get("provider"),
      status: q.get("status"),
      event_type: q.get("event_type"),
      mode: q.get("mode"),
    }),
  })
}
