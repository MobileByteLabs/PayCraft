import Link from "next/link"
import crypto from "crypto"
import { Check, ExternalLink, Plug } from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardBody } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button, ButtonLink } from "@/components/ui/button"

const MANUAL_PROVIDERS = [
  { key: "razorpay", label: "Razorpay", locale: "India + 100 countries" },
  { key: "paddle", label: "Paddle", locale: "Worldwide MoR" },
  { key: "paypal", label: "PayPal", locale: "US, GB, EU" },
  { key: "flutterwave", label: "Flutterwave", locale: "Africa" },
  { key: "paystack", label: "Paystack", locale: "Nigeria" },
  { key: "midtrans", label: "Midtrans", locale: "Indonesia" },
  { key: "btcpay", label: "BTCPay", locale: "Crypto" },
  { key: "lemonsqueezy", label: "Lemon Squeezy", locale: "Worldwide MoR" },
]

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

  const stripeClientId = process.env.PAYCRAFT_PLATFORM_STRIPE_CLIENT_ID
  const supabaseUrl =
    process.env.NEXT_PUBLIC_PAYCRAFT_SUPABASE_URL ??
    process.env.NEXT_PUBLIC_SUPABASE_URL!
  const stateSecret =
    process.env.PAYCRAFT_OAUTH_STATE_SECRET ?? "dev-secret-for-local-only"
  const sig = crypto
    .createHmac("sha256", stateSecret)
    .update(tenant.id)
    .digest("hex")
    .substring(0, 16)
  const oauthState = `${tenant.id}.${sig}`
  const stripeOAuthUrl = stripeClientId
    ? `https://connect.stripe.com/oauth/v2/authorize?response_type=code&client_id=${stripeClientId}&scope=read_write&redirect_uri=${encodeURIComponent(
        `${supabaseUrl}/functions/v1/stripe-connect-oauth`,
      )}&state=${oauthState}`
    : null

  return (
    <div>
      <PageHeader
        title="Payment providers"
        subtitle="Connect at least one. The SDK shows a bottom-sheet picker when 2+ providers are enabled for the user's locale."
      />

      {/* OAuth */}
      <section className="mb-10 animate-slide-up">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-2xs uppercase font-bold tracking-widest text-ink-500">
            Connect via OAuth
          </h2>
          <p className="text-xs text-ink-500">30-second flow</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="!shadow-md">
            <CardBody>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-[#635BFF]/10 flex items-center justify-center">
                    <span className="text-[#635BFF] font-bold text-base">
                      Stripe
                    </span>
                  </div>
                </div>
                {stripeConnected ? (
                  <Badge tone="success" dot>
                    Connected
                  </Badge>
                ) : (
                  <Badge tone="neutral">Not connected</Badge>
                )}
              </div>
              {stripeConnected ? (
                <div className="space-y-2 text-xs">
                  <Row label="Account">
                    <code className="font-mono text-ink-700 text-2xs">
                      {stripeConnected.stripe_account_id}
                    </code>
                  </Row>
                  <Row label="Mode">
                    {stripeConnected.livemode ? (
                      <Badge tone="success">Live</Badge>
                    ) : (
                      <Badge tone="info">Test</Badge>
                    )}
                  </Row>
                  <Row label="Linked">
                    <span className="tabular-nums text-ink-600">
                      {new Date(
                        stripeConnected.connected_at as string,
                      ).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  </Row>
                  <div className="mt-4 flex items-center gap-2 border-t border-ink-100 pt-3">
                    <Button variant="ghost" size="sm">
                      Disconnect
                    </Button>
                    <Button variant="secondary" size="sm">
                      Test webhook
                    </Button>
                  </div>
                </div>
              ) : (
                <>
                  <p className="text-xs text-ink-500 mb-4 leading-relaxed">
                    Connect via OAuth — about 30 seconds. Works in 40+ countries
                    with cards, UPI, wallets, and bank debits.
                  </p>
                  <ul className="text-2xs text-ink-500 space-y-1 mb-4">
                    <li className="flex items-center gap-1.5">
                      <Check className="w-3 h-3 text-success-600" strokeWidth={3} />
                      Live + Test modes
                    </li>
                    <li className="flex items-center gap-1.5">
                      <Check className="w-3 h-3 text-success-600" strokeWidth={3} />
                      Fee: 2.9% + $0.30 / charge
                    </li>
                    <li className="flex items-center gap-1.5">
                      <Check className="w-3 h-3 text-success-600" strokeWidth={3} />
                      40+ countries
                    </li>
                  </ul>
                  {stripeOAuthUrl ? (
                    <ButtonLink
                      href={stripeOAuthUrl}
                      className="w-full justify-center"
                      trailing={
                        <ExternalLink className="w-3.5 h-3.5" strokeWidth={2} />
                      }
                    >
                      Connect with Stripe
                    </ButtonLink>
                  ) : (
                    <div className="rounded-lg bg-warning-50 border border-warning-200 px-3 py-2 text-2xs text-warning-700">
                      Set{" "}
                      <code className="font-mono">
                        PAYCRAFT_PLATFORM_STRIPE_CLIENT_ID
                      </code>{" "}
                      in the dashboard environment to enable OAuth.
                    </div>
                  )}
                </>
              )}
            </CardBody>
          </Card>

          <Card className="!border-dashed flex items-center justify-center">
            <div className="text-center p-8">
              <Plug className="w-5 h-5 text-ink-400 mx-auto mb-2" strokeWidth={2} />
              <p className="text-sm font-medium text-ink-700">
                More OAuth providers coming
              </p>
              <p className="text-xs text-ink-500 mt-1">
                Razorpay OAuth, Paddle Connect, and PayPal Marketplace are on
                the v2.0.x roadmap.
              </p>
            </div>
          </Card>
        </div>
      </section>

      {/* Manual key entry */}
      <section className="animate-slide-up">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-2xs uppercase font-bold tracking-widest text-ink-500">
            Manual key entry
          </h2>
          <p className="text-xs text-ink-500">
            8 providers — paste your live + test keys
          </p>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {MANUAL_PROVIDERS.map((p) => {
            const configured = manual.find((m: any) => m.provider === p.key)
            return (
              <Card key={p.key} className="hover:shadow-md transition-shadow">
                <CardBody>
                  <div className="flex items-center justify-between">
                    <div className="font-semibold text-ink-900">{p.label}</div>
                    {configured ? (
                      <span className="text-success-600">
                        <Check className="w-3.5 h-3.5" strokeWidth={3} />
                      </span>
                    ) : (
                      <span className="text-ink-300">—</span>
                    )}
                  </div>
                  <div className="text-2xs text-ink-500 mt-1">{p.locale}</div>
                  {configured && configured.supported_locales && (
                    <div className="mt-2 text-2xs text-ink-500">
                      Locales:{" "}
                      <span className="font-mono">
                        {(configured.supported_locales as string[]).join(", ")}
                      </span>
                    </div>
                  )}
                  <Link
                    href={`/providers/${p.key}`}
                    className="mt-3 inline-block text-xs font-medium text-brand-600 hover:text-brand-700"
                  >
                    {configured ? "Edit keys →" : "Add keys →"}
                  </Link>
                </CardBody>
              </Card>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function Row({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-500">{label}</span>
      <span className="text-ink-700">{children}</span>
    </div>
  )
}
