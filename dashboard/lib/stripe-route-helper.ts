import { syncProductToStripe, toStripeInterval, type PriceInput } from "@/lib/stripe-product-sync"
import { syncProductToRazorpay } from "@/lib/razorpay-product-sync"
import { syncProductToCashfree } from "@/lib/cashfree-product-sync"
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
    // Unified status check — recognizes BOTH the OAuth Connect path and the
    // Manual API keys path. The old code only checked tenant_stripe_connect
    // (OAuth) and silently skipped manual-keys tenants, which is why products
    // created post-Manual-connection never landed in Stripe.
    const { data: connect, error: connectErr } = await supabase
      .rpc("tenant_stripe_provider_status", { p_tenant_id: tenantId })
      .single<{ source: string | null; account_id: string | null; livemode: boolean }>()
    if (connectErr || !connect?.source) return

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
      // Nest under the product's SKU so multi-product tenants don't overwrite
      // each other's currency entries. Migration 070 introduced this RPC.
      supabase.rpc("tenant_providers_merge_payment_links", {
        p_tenant_id: tenantId,
        p_provider: "stripe",
        p_mode: connect.livemode ? "live" : "test",
        p_sku: body.sku,
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
): Promise<{ ok: boolean; error?: string }> {
  const { tenantId, productId, body, existingRazorpayPlanIds } = opts
  try {
    // Check Razorpay connection status (live keys preferred; fall back to test).
    const { data: rpStatus } = await supabase
      .rpc("tenant_providers_status", { p_tenant_id: tenantId, p_provider: "razorpay" })
      .single<{ test_key_id: string | null; live_key_id: string | null; connected: boolean }>()
    if (!rpStatus?.connected) return { ok: false, error: "Razorpay is not connected for this tenant" }

    const mode: "test" | "live" = rpStatus.live_key_id ? "live" : "test"
    const prices = buildPriceInputs(body)
    if (!prices.length) return { ok: false, error: "no pricing rows for this product" }

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
      supabase.rpc("tenant_providers_merge_payment_links", {
        p_tenant_id: tenantId,
        p_provider: "razorpay",
        p_mode: mode,
        p_sku: body.sku,
        p_payment_links: result.paymentLinksByCurrency,
      }),
    ])

    // Nothing landed and every currency was rejected by Razorpay → tell the
    // operator exactly what to do (Razorpay is INR-first; USD-only products need
    // an INR price, or International payments enabled on the Razorpay account).
    const created =
      Object.keys(result.planIdsByCurrency).length +
      Object.keys(result.paymentLinksByCurrency).length
    if (created === 0 && result.skippedCurrencies.length > 0) {
      return {
        ok: false,
        error: `Razorpay does not accept ${result.skippedCurrencies.join(", ")} for this account. Add an INR price for this product (or enable International payments on Razorpay).`,
      }
    }
    return { ok: true }
  } catch (e: any) {
    // The Razorpay SDK rejects with a PLAIN OBJECT { statusCode, error: { code,
    // description, ... } } — NOT an Error instance — so e.message is undefined.
    // Dig out the real reason (e.g. "Currency is not supported") and surface it
    // instead of swallowing the failure behind a generic "check credentials".
    const detail =
      e?.error?.description ??
      e?.error?.error?.description ??
      e?.message ??
      (typeof e === "object" ? JSON.stringify(e) : String(e))
    const code = e?.statusCode ?? e?.error?.code
    const msg = `Razorpay${code ? ` [${code}]` : ""}: ${detail}`
    console.error("[products] razorpay sync failed:", msg)
    return { ok: false, error: msg }
  }
}

/**
 * Best-effort Cashfree sync — same shape as Stripe / Razorpay. Skips when
 * Cashfree isn't connected for this tenant; logs failures without
 * surfacing to caller.
 */
export async function cashfreeSyncProduct(
  supabase: ReturnType<typeof createClient>,
  opts: SyncOptions,
): Promise<void> {
  const { tenantId, productId, body } = opts
  try {
    const { data: status } = await supabase
      .rpc("tenant_providers_status", { p_tenant_id: tenantId, p_provider: "cashfree" })
      .single<{ test_key_id: string | null; live_key_id: string | null; connected: boolean }>()
    if (!status?.connected) return

    const mode: "test" | "live" = status.live_key_id ? "live" : "test"

    // Decrypt the key pair via the same RPC as Stripe — service_role can
    // pull it directly. For dashboard-side calls the user's session also
    // works via tenant_admins check.
    const { data: decrypted } = await supabase
      .rpc("tenant_providers_decrypt_key", {
        p_tenant_id: tenantId,
        p_provider: "cashfree",
        p_mode: mode,
      })
      .single<{ secret_key: string; key_id: string }>()
    if (!decrypted?.secret_key || !decrypted?.key_id) return

    const prices = buildPriceInputs(body)
    if (!prices.length) return

    const result = await syncProductToCashfree(
      tenantId,
      productId,
      body.display_name,
      body.type,
      prices,
      decrypted.key_id,
      decrypted.secret_key,
      mode,
    )

    if (Object.keys(result.paymentLinksByCurrency).length === 0) return

    await supabase.rpc("tenant_providers_merge_payment_links", {
      p_tenant_id: tenantId,
      p_provider: "cashfree",
      p_mode: mode,
      p_sku: body.sku,
      p_payment_links: result.paymentLinksByCurrency,
    })
  } catch (e: any) {
    console.error("[products] cashfree sync failed:", e.message)
  }
}
