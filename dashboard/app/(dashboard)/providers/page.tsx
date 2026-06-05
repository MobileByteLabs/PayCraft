import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import crypto from "crypto"

const OAUTH_PROVIDERS = ["stripe"] as const
const MANUAL_PROVIDERS = [
  "razorpay",
  "paddle",
  "paypal",
  "flutterwave",
  "paystack",
  "midtrans",
  "btcpay",
  "lemonsqueezy",
] as const

export default async function ProvidersPage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()
  const [oauthRes, manualRes] = await Promise.all([
    supabase
      .from("tenant_stripe_connect")
      .select("stripe_account_id,livemode,connected_at")
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
    supabase
      .from("tenant_providers")
      .select("provider,supported_locales")
      .eq("tenant_id", tenant.id),
  ])

  const stripeConnected = oauthRes.data
  const manual = manualRes.data ?? []

  // HMAC-signed state to match the edge function's CSRF check.
  const oauthState =
    tenant.id +
    "." +
    crypto
      .createHmac("sha256", process.env.PAYCRAFT_OAUTH_STATE_SECRET ?? "dev-secret")
      .update(tenant.id)
      .digest("hex")
      .substring(0, 16)

  const stripeClientId = process.env.PAYCRAFT_PLATFORM_STRIPE_CLIENT_ID
  const redirectUri = `${process.env.NEXT_PUBLIC_PAYCRAFT_SUPABASE_URL}/functions/v1/stripe-connect-oauth`
  const stripeOAuthUrl = stripeClientId
    ? `https://connect.stripe.com/oauth/v2/authorize?response_type=code&client_id=${stripeClientId}&scope=read_write&redirect_uri=${encodeURIComponent(redirectUri)}&state=${oauthState}`
    : null

  return (
    <div>
      <h1 className="text-2xl font-bold text-gray-900">Payment providers</h1>
      <p className="text-sm text-gray-500 mb-8">
        Connect at least one. The SDK shows a bottom-sheet picker when 2+
        providers are enabled for the user's locale.
      </p>

      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Connect via OAuth
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-lg border border-gray-200 bg-white p-5">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium text-gray-900">Stripe</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  Card, UPI, wallets — globally
                </div>
              </div>
              {stripeConnected ? (
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">
                  Connected
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">
                  Not connected
                </span>
              )}
            </div>
            {stripeConnected ? (
              <div className="mt-3 text-xs text-gray-500 space-y-0.5">
                <div>
                  Account:{" "}
                  <code className="font-mono">
                    {stripeConnected.stripe_account_id}
                  </code>
                </div>
                <div>
                  Mode: {stripeConnected.livemode ? "Live" : "Test"}
                </div>
                <div>
                  Linked:{" "}
                  {new Date(
                    stripeConnected.connected_at as string,
                  ).toLocaleDateString()}
                </div>
              </div>
            ) : stripeOAuthUrl ? (
              <a
                href={stripeOAuthUrl}
                className="mt-3 inline-block rounded bg-brand-600 text-white px-4 py-1.5 text-sm font-medium hover:bg-brand-700"
              >
                Connect Stripe
              </a>
            ) : (
              <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
                Set <code>PAYCRAFT_PLATFORM_STRIPE_CLIENT_ID</code> in the
                dashboard environment to enable OAuth. See docs.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="mt-10">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">
          Manual key entry
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {MANUAL_PROVIDERS.map((p) => {
            const configured = manual.find((m: any) => m.provider === p)
            return (
              <div
                key={p}
                className="rounded-lg border border-gray-200 bg-white p-4"
              >
                <div className="flex items-center justify-between">
                  <div className="font-medium text-gray-900 capitalize">
                    {p}
                  </div>
                  {configured ? (
                    <span className="text-xs text-green-700">✓</span>
                  ) : (
                    <span className="text-xs text-gray-400">—</span>
                  )}
                </div>
                {configured && configured.supported_locales && (
                  <div className="mt-2 text-xs text-gray-500">
                    Locales: {(configured.supported_locales as string[]).join(", ")}
                  </div>
                )}
                <a
                  href={`/providers/${p}`}
                  className="mt-3 inline-block text-xs font-medium text-brand-600 hover:underline"
                >
                  {configured ? "Edit keys →" : "Add keys →"}
                </a>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}
