// supabase/functions/_shared/winback-offer.ts
//
// Win-back offers (paycraft-paywall-analytics, GOAL D3 / D7): what makes an offer usable, who it belongs to,
// and on which payment lanes its discount can be applied. Pure — the `winback` function and `checkout-initiate`
// load the rows and call these, so the rules are unit-tested in one place.

import { type CouponRow, redeemableNow } from "./exit-survey.ts"

export type OfferRow = {
  id: string
  tenant_id: string
  user_ref: string
  coupon_id: string
  expires_at: string
  redeemed_at: string | null
}

export type OfferCoupon = CouponRow & {
  stripe_coupon_id: string | null
  stripe_promotion_code_id: string | null
  razorpay_offer_id: string | null
  googleplay_offer_ids: Record<string, string> | null
  appstore_offer_ids: Record<string, string> | null
}

async function sha256Hex(s: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Who an offer belongs to: the account (a hash of tenant + email, lower-cased) when the buyer is signed in,
 * otherwise the device. Never the email itself. Null when neither is known — no offer can be bound then.
 * The account form is the same hash `events` stores as `user_ref`, so the funnel and offers join.
 */
export async function buyerRef(tenantId: string, email: string | null, deviceRef: string | null): Promise<string | null> {
  if (email) return sha256Hex(`${tenantId}:${email.toLowerCase()}`)
  if (deviceRef) return sha256Hex(`${tenantId}:device:${deviceRef}`)
  return null
}

/** The offer can be applied now, by this buyer: theirs, this tenant's, unexpired, unredeemed, coupon still live. */
export function offerUsable(o: OfferRow, c: OfferCoupon, tenantId: string, userRef: string | null, now = Date.now()): boolean {
  return o.tenant_id === tenantId &&
    !!userRef && o.user_ref === userRef &&
    !o.redeemed_at &&
    Date.parse(o.expires_at) > now &&
    o.coupon_id === c.id &&
    redeemableNow(c, now)
}

/** Where this coupon's discount exists for [productId]: web/PSP checkout and each store's offer id. */
export function lanesFor(c: OfferCoupon, productId: string | null) {
  return {
    stripe: !!(c.stripe_promotion_code_id || c.stripe_coupon_id),
    razorpay: !!c.razorpay_offer_id,
    google_play: (productId && c.googleplay_offer_ids?.[productId]) || null,
    app_store: (productId && c.appstore_offer_ids?.[productId]) || null,
  }
}
