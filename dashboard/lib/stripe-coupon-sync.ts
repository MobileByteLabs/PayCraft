import type Stripe from "stripe"
import { getConnectedStripeClient } from "./stripe-client"
import { createClient } from "./supabase-server"

/**
 * Create — or reuse — the Stripe Coupon + PromotionCode that backs a
 * `tenant_coupons` row. The Coupon carries the % discount and duration policy;
 * the PromotionCode is the customer-typeable code attached to that Coupon.
 *
 * Idempotency: if the row already has stripe_coupon_id + stripe_promotion_code_id,
 * this is a no-op (Stripe Coupons are immutable; updating an existing one is
 * not supported). Toggling `active=false` on the tenant_coupons row is the
 * way to retire a discount.
 *
 * Best-effort: failures are logged but do not block the dashboard CRUD flow.
 */
export async function syncCouponToStripe(opts: {
  tenantId: string
  couponRowId: string
  code: string
  name: string | null
  percentOff: number
  duration: "once" | "repeating" | "forever"
  durationInMonths: number | null
  maxRedemptions: number | null
  redeemBy: string | null
  existingStripeCouponId: string | null
  existingStripePromotionCodeId: string | null
}): Promise<{ stripeCouponId: string; stripePromotionCodeId: string } | null> {
  if (opts.existingStripeCouponId && opts.existingStripePromotionCodeId) {
    return {
      stripeCouponId: opts.existingStripeCouponId,
      stripePromotionCodeId: opts.existingStripePromotionCodeId,
    }
  }

  let stripe: Stripe
  try {
    stripe = await getConnectedStripeClient(opts.tenantId)
  } catch (e: any) {
    console.warn("[stripe-coupon-sync] tenant not connected, skipping:", e.message)
    return null
  }

  const couponParams: Stripe.CouponCreateParams = {
    percent_off: opts.percentOff,
    duration: opts.duration,
    name: opts.name ?? opts.code,
    metadata: { paycraft_coupon_id: opts.couponRowId },
  }
  if (opts.duration === "repeating" && opts.durationInMonths) {
    couponParams.duration_in_months = opts.durationInMonths
  }
  if (opts.maxRedemptions) couponParams.max_redemptions = opts.maxRedemptions
  if (opts.redeemBy) {
    couponParams.redeem_by = Math.floor(new Date(opts.redeemBy).getTime() / 1000)
  }

  const coupon = await stripe.coupons.create(couponParams, {
    idempotencyKey: `paycraft:coupon:${opts.couponRowId}`,
  })

  const promo = await stripe.promotionCodes.create(
    {
      coupon: coupon.id,
      code: opts.code,
      active: true,
      max_redemptions: opts.maxRedemptions ?? undefined,
      expires_at: opts.redeemBy
        ? Math.floor(new Date(opts.redeemBy).getTime() / 1000)
        : undefined,
      metadata: { paycraft_coupon_id: opts.couponRowId },
    },
    { idempotencyKey: `paycraft:promo:${opts.couponRowId}` },
  )

  const supabase = createClient()
  await supabase.rpc("tenant_coupons_set_stripe_ids", {
    p_id: opts.couponRowId,
    p_stripe_coupon_id: coupon.id,
    p_stripe_promotion_code_id: promo.id,
  })

  return { stripeCouponId: coupon.id, stripePromotionCodeId: promo.id }
}

/**
 * Best-effort wrapper for the dashboard's POST /api/coupons handler — never
 * surfaces failures to the caller. Same pattern as stripeSyncProduct.
 */
export async function syncCouponBestEffort(args: Parameters<typeof syncCouponToStripe>[0]) {
  try {
    await syncCouponToStripe(args)
  } catch (e: any) {
    console.error("[stripe-coupon-sync] failed:", e.message)
  }
}

/**
 * Auto-discount coupon for a product with discount_percent set. One Coupon per
 * product (idempotency keyed on product_id + percent), stored in
 * tenant_products.discount_stripe_coupon_id so the checkout flow can apply it.
 */
export async function syncProductDiscountCoupon(opts: {
  tenantId: string
  productId: string
  discountPercent: number
  discountEndsAt: string | null
  existingDiscountStripeCouponId: string | null
}): Promise<string | null> {
  // If the existing coupon already matches this percent, reuse. (Stripe Coupons
  // are immutable, so we always create a fresh one when percent changes.)
  let stripe: Stripe
  try {
    stripe = await getConnectedStripeClient(opts.tenantId)
  } catch {
    return null
  }

  const idempotencyKey = `paycraft:productdiscount:${opts.productId}:${opts.discountPercent}`
  const couponParams: Stripe.CouponCreateParams = {
    percent_off: opts.discountPercent,
    duration: "once", // product-level discount applies to the first invoice only
    name: `${opts.discountPercent}% off`,
    metadata: { paycraft_product_id: opts.productId, source: "product_discount" },
  }
  if (opts.discountEndsAt) {
    couponParams.redeem_by = Math.floor(new Date(opts.discountEndsAt).getTime() / 1000)
  }
  const coupon = await stripe.coupons.create(couponParams, { idempotencyKey })

  const supabase = createClient()
  await supabase.rpc("tenant_products_set_discount_coupon_id", {
    p_id: opts.productId,
    p_discount_stripe_coupon_id: coupon.id,
  })
  return coupon.id
}
