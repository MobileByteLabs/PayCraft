import Stripe from "stripe"
import { createClient } from "@/lib/supabase-server"

/**
 * Server-side Stripe SDK wrapper.
 *
 * Two modes:
 *  - getPlatformStripeClient(): uses the PayCraft platform secret key (for OAuth code exchange).
 *  - getConnectedStripeClient(tenantId): decrypts the tenant's stored access_token and returns
 *    a Stripe client scoped to that connected account. Used for product/price/payment-link
 *    auto-creation in the user's Stripe account.
 */

const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2024-11-20.acacia"

export function getPlatformStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY
  if (!key) throw new Error("STRIPE_SECRET_KEY not configured")
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION })
}

export async function getConnectedStripeClient(tenantId: string): Promise<Stripe> {
  const supabase = createClient()
  const { data, error } = await supabase
    .rpc("tenant_stripe_connect_decrypt", { p_tenant_id: tenantId })
    .single<{ access_token: string }>()
  if (error || !data?.access_token) {
    throw new Error(`No Stripe Connect for tenant ${tenantId}: ${error?.message ?? "no row"}`)
  }
  return new Stripe(data.access_token, { apiVersion: STRIPE_API_VERSION })
}
