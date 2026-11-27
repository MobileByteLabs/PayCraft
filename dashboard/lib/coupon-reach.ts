/**
 * Where a coupon actually discounts: every provider whose sync gave it an id. The coupons table used to
 * check Stripe alone, so a code that reached Google Play (Reels Downloader's COMEBACK25) read "Not synced".
 */
export interface CouponProviderIds {
  stripe_coupon_id?: string | null
  razorpay_offer_id?: string | null
  googleplay_offer_ids?: Record<string, string> | null
  appstore_offer_ids?: Record<string, string> | null
}

const hasAny = (ids: Record<string, string> | null | undefined) => !!ids && Object.values(ids).some(Boolean)

export function couponReach(c: CouponProviderIds): string[] {
  return [
    c.stripe_coupon_id ? "Stripe" : null,
    c.razorpay_offer_id ? "Razorpay" : null,
    hasAny(c.googleplay_offer_ids) ? "Google Play" : null,
    hasAny(c.appstore_offer_ids) ? "App Store" : null,
  ].filter((p): p is string => p !== null)
}
