import Razorpay from "razorpay"
import { createClient } from "./supabase-server"
import { getConnectedRazorpayClient } from "./razorpay-client"

/**
 * Create a matching Razorpay Offer for a PayCraft coupon row. Razorpay's
 * subscription system applies offers at subscription-creation time via the
 * `offer_id` parameter, so the SDK reads the persisted ID + passes it through
 * when generating a subscription link.
 *
 * Best-effort: failures are logged but never surface to the dashboard CRUD flow.
 */
export async function syncCouponToRazorpay(opts: {
  tenantId: string
  couponRowId: string
  code: string
  name: string | null
  percentOff: number
  duration: "once" | "repeating" | "forever"
  durationInMonths: number | null
  maxRedemptions: number | null
  redeemBy: string | null
  existingRazorpayOfferId: string | null
}): Promise<{ razorpayOfferId: string } | null> {
  if (opts.existingRazorpayOfferId) {
    return { razorpayOfferId: opts.existingRazorpayOfferId }
  }

  let client: Razorpay
  try {
    client = await getConnectedRazorpayClient(opts.tenantId, "live")
  } catch {
    try {
      client = await getConnectedRazorpayClient(opts.tenantId, "test")
    } catch (e: any) {
      console.warn("[razorpay-coupon-sync] tenant has no Razorpay connection:", e.message)
      return null
    }
  }

  // Razorpay Offer API: /v1/offers. The Node SDK exposes it as `client.offers`.
  // For percentage discounts: percent_rate is the integer 1..100.
  // For subscriptions: redemption_type "subscription" + payment_method "card".
  // Duration semantics differ from Stripe — Razorpay's `iterations` is the
  // number of billing cycles the offer applies for.
  const iterations =
    opts.duration === "once"
      ? 1
      : opts.duration === "repeating"
        ? opts.durationInMonths ?? 1
        : 999 // "forever" — Razorpay caps at the subscription's natural length

  const payload: Record<string, unknown> = {
    name: opts.name ?? opts.code,
    percent_rate: opts.percentOff * 100, // Razorpay expects basis-points: 25% → 2500
    redemption_type: "subscription",
    applicable_on: "all_plans",
    iterations,
    no_of_applications: opts.maxRedemptions ?? 0, // 0 = unlimited per Razorpay docs
    notes: {
      paycraft_coupon_id: opts.couponRowId,
      paycraft_code: opts.code,
    },
  }
  if (opts.redeemBy) {
    payload.ends_at = Math.floor(new Date(opts.redeemBy).getTime() / 1000)
  }

  let offerId: string
  try {
    // razorpay node SDK types lag the REST API; `offers` is REST-only
    const resp = await (client as any).offers.create(payload)
    offerId = resp.id
  } catch (e: any) {
    console.error("[razorpay-coupon-sync] offers.create failed:", e?.error?.description ?? e.message)
    return null
  }

  const supabase = createClient()
  await supabase
    .from("tenant_coupons")
    .update({ razorpay_offer_id: offerId, updated_at: new Date().toISOString() })
    .eq("id", opts.couponRowId)

  return { razorpayOfferId: offerId }
}

export async function syncCouponBestEffort(args: Parameters<typeof syncCouponToRazorpay>[0]) {
  try {
    await syncCouponToRazorpay(args)
  } catch (e: any) {
    console.error("[razorpay-coupon-sync] failed:", e.message)
  }
}
