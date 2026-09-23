import { listResource } from "@/lib/api-v1-helpers"
export const dynamic = "force-dynamic"

/**
 * GET /v1/entitlements — the canonical "is this user entitled right now" record.
 *
 * Distinct from /v1/subscribers: a subscription is what a provider bills, an entitlement is what
 * PayCraft grants. They disagree during grace periods, refunds and store-side cancellations, and
 * the entitlement is the one an app should trust.
 *
 * `is_sandbox` is exposed because it is also the evidence that proves store test mode — a sandbox
 * entitlement arriving here is what turns Play/App Store readiness green.
 */
export async function GET(req: Request) {
  return listResource(req, "subscribers:read", {
    table: "entitlement_records",
    columns:
      "id, app_user_id, provider, product_id, canonical_state, expires_at, will_renew, " +
      "in_grace_until, is_sandbox, latest_event_ts, updated_at",
    orderBy: { column: "updated_at", ascending: false },
    filters: (q) => ({
      app_user_id: q.get("app_user_id"),
      provider: q.get("provider"),
      canonical_state: q.get("state"),
    }),
  })
}
