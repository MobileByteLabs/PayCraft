import { couponReach } from "@/lib/coupon-reach"

describe("couponReach", () => {
  it("names every provider the coupon was synced to", () => {
    expect(couponReach({
      stripe_coupon_id: "co_1",
      razorpay_offer_id: "offer_1",
      googleplay_offer_ids: { p1: "pro-monthly-cpn" },
      appstore_offer_ids: { p1: "promo" },
    })).toEqual(["Stripe", "Razorpay", "Google Play", "App Store"])
  })

  // COMEBACK25 on Reels Downloader: Play only — it used to read "Not synced".
  it("a store-only coupon is not unsynced", () => {
    expect(couponReach({ googleplay_offer_ids: { p1: "pro-quarterly-autorenew-cpn-comeback25" } })).toEqual(["Google Play"])
  })

  it("empty maps and nulls reach nothing", () => {
    expect(couponReach({ stripe_coupon_id: null, googleplay_offer_ids: {}, appstore_offer_ids: { p1: "" } })).toEqual([])
  })
})
