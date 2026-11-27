import { syncCouponToStripe } from "./stripe-coupon-sync"
import { syncCouponToRazorpay } from "./razorpay-coupon-sync"
import { syncCouponToGooglePlay } from "./googleplay-coupon-sync"
import { syncCouponToAppStore } from "./appstore-coupon-sync"

/**
 * Generic coupon → provider fan-out.
 *
 * A PayCraft coupon applies to EVERY connected provider by default. Each adapter
 * is best-effort and self-skips when the tenant hasn't connected that provider,
 * so there is no per-route wiring and no "which providers?" decision — adding a
 * provider is one line in PROVIDER_COUPON_ADAPTERS. Stripe/Razorpay create a
 * single coupon/offer; Google Play/App Store create a discounted subscription
 * offer per applicable product (see the respective *-coupon-sync modules).
 */

export interface CouponSyncArgs {
  tenantId: string
  couponRowId: string
  code: string
  name: string | null
  percentOff: number
  duration: "once" | "repeating" | "forever"
  durationInMonths: number | null
  maxRedemptions: number | null
  redeemBy: string | null
  appliesToProductIds: string[] | null
}

interface CouponAdapter {
  provider: string
  run: (args: CouponSyncArgs) => Promise<void>
}

// The single source of truth for where coupons sync. Every connected provider
// gets the coupon; unconnected ones no-op inside their adapter.
export const PROVIDER_COUPON_ADAPTERS: CouponAdapter[] = [
  {
    provider: "stripe",
    run: async (a) => {
      await syncCouponToStripe({ ...a, existingStripeCouponId: null, existingStripePromotionCodeId: null })
    },
  },
  {
    provider: "razorpay",
    run: async (a) => {
      await syncCouponToRazorpay({ ...a, existingRazorpayOfferId: null })
    },
  },
  { provider: "google_play", run: async (a) => { await syncCouponToGooglePlay(a) } },
  { provider: "app_store", run: async (a) => { await syncCouponToAppStore(a) } },
]

/** Fan a coupon out to every provider (best-effort — one failure never blocks the rest). */
/** The providers a coupon syncs to — the dashboard calls `/api/coupons/{id}/sync?provider=…` once for each. */
export const COUPON_SYNC_PROVIDERS: readonly string[] = PROVIDER_COUPON_ADAPTERS.map((a) => a.provider)

/** A `tenant_coupons` row → the arguments every adapter takes. */
export function couponSyncArgsFromRow(row: {
  id: string
  tenant_id: string
  code: string
  name?: string | null
  percent_off: number | string
  duration: CouponSyncArgs["duration"]
  duration_in_months?: number | null
  max_redemptions?: number | null
  redeem_by?: string | null
  applies_to_product_ids?: string[] | null
}): CouponSyncArgs {
  return {
    tenantId: row.tenant_id,
    couponRowId: row.id,
    code: row.code,
    name: row.name ?? null,
    percentOff: Number(row.percent_off),
    duration: row.duration,
    durationInMonths: row.duration_in_months ?? null,
    maxRedemptions: row.max_redemptions ?? null,
    redeemBy: row.redeem_by ?? null,
    appliesToProductIds: row.applies_to_product_ids?.length ? row.applies_to_product_ids : null,
  }
}

/**
 * Sync a coupon to ONE provider — used on the free Cloudflare tier where the
 * full fan-out (esp. Google Play / App Store iterating every product) exceeds the
 * 50-subrequest-per-invocation cap. Callers hit the endpoint once per provider.
 */
export async function syncCouponToProvider(
  provider: string,
  args: CouponSyncArgs,
): Promise<{ ran: boolean; error?: string }> {
  const adapter = PROVIDER_COUPON_ADAPTERS.find((a) => a.provider === provider)
  if (!adapter) return { ran: false, error: "unknown provider" }
  try {
    await adapter.run(args)
    return { ran: true }
  } catch (e: any) {
    return { ran: true, error: e?.message ?? String(e) }
  }
}
