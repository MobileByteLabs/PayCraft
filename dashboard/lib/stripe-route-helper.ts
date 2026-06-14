import { syncProductToStripe, toStripeInterval, type PriceInput } from "@/lib/stripe-product-sync"
import { syncProductToRazorpay } from "@/lib/razorpay-product-sync"
import { createClient } from "@/lib/supabase-server"

interface SyncOptions {
  tenantId: string
  productId: string
  body: Record<string, any>
  existingStripeProductId?: string
  existingPrices?: Record<string, string>
  existingRazorpayPlanIds?: Record<string, string>
}

function buildPriceInputs(body: Record<string, any>): PriceInput[] {
  if (Array.isArray(body.pricing_rows) && body.pricing_rows.length > 0) {
    return body.pricing_rows.map((r: { currency: string; amount_cents: number }) => ({
      currency: r.currency,
      amountCents: r.amount_cents,
    }))
  }
  if (body.base_price_cents && body.base_currency) {
    return [{ currency: body.base_currency, amountCents: body.base_price_cents }]
  }
  return []
}

/**
 * Best-effort Stripe sync — failures are logged, never surface to the caller.
 */
export async function stripeSyncProduct(
  supabase: ReturnType<typeof createClient>,
  opts: SyncOptions,
): Promise<void> {
  const { tenantId, productId, body, existingStripeProductId, existingPrices } = opts
  try {
    const { data: connect, error: connectErr } = await supabase
      .rpc("tenant_stripe_connect_status", { p_tenant_id: tenantId })
      .single<{ stripe_account_id: string; livemode: boolean }>()
    if (connectErr || !connect) return

    const prices = buildPriceInputs(body)
    if (!prices.length) return

    const result = await syncProductToStripe(
      tenantId,
      productId,
      body.display_name,
      body.type,
      toStripeInterval(body.interval),
      prices,
      { stripeProductId: existingStripeProductId, existingPrices },
    )

    await Promise.all([
      supabase.rpc("tenant_products_set_stripe_ids", {
        p_id: productId,
        p_stripe_product_id: result.stripeProductId,
        p_stripe_price_id_by_currency: result.pricesByCurrency,
      }),
      supabase.rpc("tenant_providers_set_payment_links", {
        p_tenant_id: tenantId,
        p_provider: "stripe",
        p_mode: connect.livemode ? "live" : "test",
        p_payment_links: result.paymentLinksByCurrency,
      }),
    ])
  } catch (e: any) {
    console.error("[products] stripe sync failed:", e.message)
  }
}

/**
 * Best-effort Razorpay sync — failures are logged, never surface to the caller.
 */
export async function razorpaySyncProduct(
  supabase: ReturnType<typeof createClient>,
  opts: SyncOptions,
): Promise<void> {
  const { tenantId, productId, body, existingRazorpayPlanIds } = opts
  try {
    // Check Razorpay connection status (live keys preferred; fall back to test).
    const { data: rpStatus } = await supabase
      .rpc("tenant_providers_status", { p_tenant_id: tenantId, p_provider: "razorpay" })
      .single<{ test_key_id: string | null; live_key_id: string | null; connected: boolean }>()
    if (!rpStatus?.connected) return

    const mode: "test" | "live" = rpStatus.live_key_id ? "live" : "test"
    const prices = buildPriceInputs(body)
    if (!prices.length) return

    const result = await syncProductToRazorpay(
      tenantId,
      productId,
      body.display_name,
      body.type,
      body.interval ?? null,
      prices,
      mode,
      existingRazorpayPlanIds,
    )

    await Promise.all([
      supabase.rpc("tenant_products_set_razorpay_ids", {
        p_id: productId,
        p_razorpay_plan_id_by_currency: result.planIdsByCurrency,
      }),
      supabase.rpc("tenant_providers_set_payment_links", {
        p_tenant_id: tenantId,
        p_provider: "razorpay",
        p_mode: mode,
        p_payment_links: result.paymentLinksByCurrency,
      }),
    ])
  } catch (e: any) {
    console.error("[products] razorpay sync failed:", e.message)
  }
}
