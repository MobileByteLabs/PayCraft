import { listResource } from "@/lib/api-v1-helpers"
export const dynamic = "force-dynamic"

/**
 * GET /v1/subscribers — subscription records.
 *
 * `mode` is returned and filterable: a support question is almost always "is this person's LIVE
 * subscription active", and a test-mode row answers a different question convincingly.
 */
export async function GET(req: Request) {
  return listResource(req, "subscribers:read", {
    table: "subscriptions",
    columns:
      "id, email, plan, status, provider, mode, current_period_start, current_period_end, " +
      "cancel_at_period_end, trial_start, trial_end, created_at, updated_at",
    orderBy: { column: "created_at", ascending: false },
    filters: (q) => ({
      email: q.get("email"),
      status: q.get("status"),
      provider: q.get("provider"),
      mode: q.get("mode"),
    }),
  })
}
