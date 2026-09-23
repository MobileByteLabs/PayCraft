import { listResource } from "@/lib/api-v1-helpers"
export const dynamic = "force-dynamic"

/** GET /v1/coupons — discount codes and their per-provider counterparts. */
export async function GET(req: Request) {
  return listResource(req, "coupons:read", {
    table: "tenant_coupons",
    columns:
      "id, code, name, percent_off, duration, duration_in_months, max_redemptions, redeem_by, " +
      "applies_to_product_ids, times_redeemed, active, stripe_coupon_id, razorpay_offer_id, " +
      "googleplay_offer_ids, appstore_offer_ids, created_at",
    orderBy: { column: "created_at", ascending: false },
    filters: (q) => ({ code: q.get("code") }),
  })
}
