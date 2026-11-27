import { COUPON_SYNC_PROVIDERS, couponSyncArgsFromRow } from "@/lib/coupon-provider-sync"

// The dashboard syncs a coupon one provider per request (Cloudflare's per-invocation sub-request cap); a
// fire-and-forget fan-out after the response was cut off, so COMEBACK25 (2026-11-27) reached no store at all.
describe("coupon provider sync", () => {
  it("names every store a coupon reaches", () => {
    expect(COUPON_SYNC_PROVIDERS).toEqual(["stripe", "razorpay", "google_play", "app_store"])
  })

  it("maps a tenant_coupons row to the adapters' arguments", () => {
    expect(
      couponSyncArgsFromRow({
        id: "c-1", tenant_id: "t-1", code: "COMEBACK25", name: null, percent_off: "25", duration: "once",
        duration_in_months: null, max_redemptions: null, redeem_by: null, applies_to_product_ids: [],
      }),
    ).toEqual({
      tenantId: "t-1", couponRowId: "c-1", code: "COMEBACK25", name: null, percentOff: 25, duration: "once",
      durationInMonths: null, maxRedemptions: null, redeemBy: null, appliesToProductIds: null,
    })
  })

  it("keeps an explicit product scope", () => {
    const a = couponSyncArgsFromRow({ id: "c", tenant_id: "t", code: "X", percent_off: 10, duration: "forever", applies_to_product_ids: ["p-1"] })
    expect(a.appliesToProductIds).toEqual(["p-1"])
  })
})
