import Stripe from "stripe"
import { createClient } from "@/lib/supabase-server"
import { createClient as createServiceClient } from "@supabase/supabase-js"

/**
 * Server-side Stripe SDK wrapper.
 *
 * Three modes:
 *  - getPlatformStripeClient():
 *      Returns the PayCraft platform Stripe client (used for OAuth code exchange).
 *      Reads `stripe_platform_secret_key` from `platform_secrets` FIRST, falling
 *      back to the `STRIPE_SECRET_KEY` env var. The DB-first path lets the
 *      deployer configure credentials hot via /admin/platform-keys without
 *      restarting Node.
 *
 *  - getPlatformConnectClientId():
 *      Companion fetcher for the OAuth start route. Same DB-first / env-fallback
 *      resolution for `STRIPE_CONNECT_CLIENT_ID`.
 *
 *  - getConnectedStripeClient(tenantId):
 *      Decrypts the tenant's stored access_token and returns a Stripe client
 *      scoped to that connected account. Used for product/price/payment-link
 *      auto-creation in the user's Stripe account.
 */

const STRIPE_API_VERSION: Stripe.LatestApiVersion = "2024-11-20.acacia"
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!

/**
 * Fetch a platform secret via the SECURITY DEFINER RPC. We use the service-role
 * client here because the OAuth flow runs without a user session in some paths
 * (Stripe redirects back to /callback with no auth cookie context), and
 * `platform_secrets_get` whitelists `service_role`.
 */
async function getPlatformSecret(key: string): Promise<string | null> {
  const admin = createServiceClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data } = await admin.rpc("platform_secrets_get", { p_key: key })
  return (data ?? null) as string | null
}

export async function getPlatformStripeClient(): Promise<Stripe> {
  const dbKey = await getPlatformSecret("stripe_platform_secret_key").catch(() => null)
  const key = dbKey ?? process.env.STRIPE_SECRET_KEY
  if (!key) {
    throw new Error(
      "Stripe platform secret key not configured. Set it at /admin/platform-keys.",
    )
  }
  return new Stripe(key, { apiVersion: STRIPE_API_VERSION })
}

export async function getPlatformConnectClientId(): Promise<string | null> {
  const dbVal = await getPlatformSecret("stripe_connect_client_id").catch(() => null)
  return dbVal ?? process.env.STRIPE_CONNECT_CLIENT_ID ?? null
}

export async function getConnectedStripeClient(tenantId: string): Promise<Stripe> {
  const supabase = createClient()

  // OAuth path first — Connect access tokens already carry the connected
  // account scope, so no on-behalf-of header is required downstream.
  const { data: oauth } = await supabase
    .rpc("tenant_stripe_connect_decrypt", { p_tenant_id: tenantId })
    .single<{ access_token: string }>()
  if (oauth?.access_token) {
    return new Stripe(oauth.access_token, { apiVersion: STRIPE_API_VERSION })
  }

  // Manual-keys fallback — decrypt the tenant's saved secret key. We prefer
  // live mode if both slots are populated (operator opted into production by
  // pasting a live key); test mode otherwise. This is the path single-tenant
  // self-hosters use when they skip Stripe Connect entirely.
  const tryMode = async (mode: "live" | "test") => {
    const { data } = await supabase
      .rpc("tenant_providers_decrypt_key", {
        p_tenant_id: tenantId,
        p_provider: "stripe",
        p_mode: mode,
      })
      .single<{ secret_key: string; key_id: string }>()
    return data?.secret_key ?? null
  }
  const liveKey = await tryMode("live").catch(() => null)
  const key = liveKey ?? (await tryMode("test").catch(() => null))
  if (key) {
    return new Stripe(key, { apiVersion: STRIPE_API_VERSION })
  }

  throw new Error(
    `No Stripe credentials for tenant ${tenantId} (neither OAuth nor Manual keys). Connect at /providers/stripe first.`,
  )
}
