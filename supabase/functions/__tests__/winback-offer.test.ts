// Win-back offers at checkout (paycraft-paywall-analytics AC-9): an offer is usable only by the buyer it was made
// to, only before it expires and only once; a usable offer puts the coupon's discount on the provider's checkout —
// a Stripe promotion code (or the coupon), a Razorpay offer id — and an unusable one never blocks checkout.
// Run: deno test --no-check supabase/functions/__tests__/winback-offer.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { buyerRef, lanesFor, offerUsable, type OfferRow, type OfferCoupon } from "../_shared/winback-offer.ts"
import { stripeSessionForm } from "../checkout-initiate/stripe-session.ts"

const coupon = (over: Partial<OfferCoupon> = {}): OfferCoupon => ({
  id: "c1", percent_off: 50, duration: "once", duration_in_months: null, active: true, redeem_by: null,
  max_redemptions: null, times_redeemed: 0, stripe_coupon_id: "co_1", stripe_promotion_code_id: "promo_1",
  razorpay_offer_id: "offer_rzp_1", googleplay_offer_ids: { p1: "winback-50" }, appstore_offer_ids: { p1: "wb50" }, ...over,
})
const offer = (over: Partial<OfferRow> = {}): OfferRow => ({
  id: "o1", tenant_id: "t1", user_ref: "u1", coupon_id: "c1", expires_at: new Date(Date.now() + 3600e3).toISOString(),
  redeemed_at: null, ...over,
})

Deno.test("an offer is usable only by its buyer, before expiry, unredeemed, with a live coupon", () => {
  assert(offerUsable(offer(), coupon(), "t1", "u1"))
  assert(!offerUsable(offer(), coupon(), "t1", "someone-else"), "another buyer")
  assert(!offerUsable(offer(), coupon(), "t2", "u1"), "another tenant")
  assert(!offerUsable(offer({ expires_at: "2000-01-01T00:00:00Z" }), coupon(), "t1", "u1"), "expired")
  assert(!offerUsable(offer({ redeemed_at: new Date().toISOString() }), coupon(), "t1", "u1"), "already redeemed")
  assert(!offerUsable(offer(), coupon({ active: false }), "t1", "u1"), "coupon switched off")
})

Deno.test("the buyer reference is a stable hash of the account, else of the device, never the email", async () => {
  const a = await buyerRef("t1", "Buyer@Example.com", "dev")
  assertEquals(a, await buyerRef("t1", "buyer@example.com", "other-device"), "the account wins, case-insensitive")
  assert(/^[0-9a-f]{64}$/.test(a!) && !a!.includes("buyer"))
  const d = await buyerRef("t1", null, "dev")
  assert(d && d !== a)
  assertEquals(await buyerRef("t1", null, null), null)
})

Deno.test("lanes list where the discount can be applied for this product", () => {
  assertEquals(lanesFor(coupon(), "p1"), { stripe: true, razorpay: true, google_play: "winback-50", app_store: "wb50" })
  assertEquals(lanesFor(coupon({ stripe_coupon_id: null, stripe_promotion_code_id: null, razorpay_offer_id: null, googleplay_offer_ids: {}, appstore_offer_ids: {} }), "p1"),
    { stripe: false, razorpay: false, google_play: null, app_store: null })
})

Deno.test("a Stripe checkout session carries the promotion code (or the coupon) when an offer applies", () => {
  const base = { priceId: "price_1", email: "a@b.c", sku: "pro-monthly", tenantId: "t1", productId: "p1", mode: "test" as const, trialDays: 0, success: "https://x/s", cancel: "https://x/c" }
  const withPromo = new URLSearchParams(stripeSessionForm({ ...base, discount: { promotionCodeId: "promo_1", couponId: "co_1" }, winbackOfferId: "o1" }))
  assertEquals(withPromo.get("discounts[0][promotion_code]"), "promo_1")
  assertEquals(withPromo.get("metadata[paycraft_winback_offer]"), "o1")
  const withCoupon = new URLSearchParams(stripeSessionForm({ ...base, discount: { promotionCodeId: null, couponId: "co_1" } }))
  assertEquals(withCoupon.get("discounts[0][coupon]"), "co_1")
  const plain = new URLSearchParams(stripeSessionForm(base))
  assertEquals(plain.get("discounts[0][promotion_code]"), null)
  assertEquals(plain.get("discounts[0][coupon]"), null)
})
