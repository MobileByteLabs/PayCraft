import Link from "next/link"
import crypto from "crypto"
import {
  CheckCircle2,
  Circle,
  ChevronRight,
  ExternalLink,
  Plus,
} from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { PageHeader } from "@/components/ui/page-header"
import { Card, CardBody } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button, ButtonLink } from "@/components/ui/button"

const MANUAL_PROVIDERS = [
  { key: "razorpay", label: "Razorpay", locale: "IN" },
  { key: "paddle", label: "Paddle", locale: null },
  { key: "paypal", label: "PayPal", locale: "US, GB, EU" },
  { key: "flutterwave", label: "Flutterwave", locale: null },
  { key: "paystack", label: "Paystack", locale: "NG" },
  { key: "midtrans", label: "Midtrans", locale: null },
  { key: "btcpay", label: "BTCPay", locale: null },
  { key: "lemonsqueezy", label: "LemonSqueezy", locale: null },
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

      {/* OAuth section */}
      <section className="mb-10 animate-slide-up">
        <div className="flex flex-col mb-6">
          <span className="text-xs font-bold uppercase tracking-wider text-ink-400">
            Connect via OAuth
          </span>
          <p className="text-ink-500 text-sm mt-1">
            Quickly link your accounts via official OAuth flows.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Stripe card */}
          <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md">
            <CardBody className="p-6">
              <div className="flex justify-between items-start mb-6">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded bg-blue-50 flex items-center justify-center">
                    <span className="text-blue-600 font-bold text-xs">S</span>
                  </div>
                  <span className="font-bold text-blue-600 tracking-tight text-xl">
                    Stripe
                  </span>
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
                <>
                  <div className="space-y-2 mb-8">
                    <Row label="Account">
                      <code className="font-mono text-ink-900 bg-ink-100 px-1 rounded text-xs">
                        {stripeConnected.stripe_account_id.substring(0, 14)}...
                      </code>
                    </Row>
                    <Row label="Mode">
                      <span className="font-medium text-ink-900 text-xs">
                        {stripeConnected.livemode ? "Live" : "Test"}
                      </span>
                    </Row>
                    <Row label="Linked">
                      <span className="font-medium text-ink-900 text-xs">
                        {new Date(
                          stripeConnected.connected_at as string,
                        ).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })}
                      </span>
                    </Row>
                  </div>
                  <div className="flex gap-3">
                    <Link href="/providers/stripe">
                      <Button variant="secondary" size="sm" className="flex-1 text-xs">
                        Test webhook
                      </Button>
                    </Link>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="flex-1 text-xs text-danger-500 hover:bg-danger-50 hover:text-danger-600"
                    >
                      Disconnect
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <p className="text-xs text-ink-500 mb-6 leading-relaxed">
                    Connect via OAuth — about 30 seconds. Works in 40+ countries
                    with cards, wallets, and bank debits.
                  </p>
                  {stripeOAuthUrl ? (
                    <ButtonLink
                      href={stripeOAuthUrl}
                      className="w-full justify-center"
                      trailing={<ExternalLink className="w-3.5 h-3.5" strokeWidth={2} />}
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
                  <Link
                    href="/providers/stripe"
                    className="mt-3 flex items-center justify-center gap-1 text-xs text-brand-600 hover:text-brand-700 font-medium"
                  >
                    Configure Stripe <ChevronRight className="w-3.5 h-3.5" />
                  </Link>
                </>
              )}
            </CardBody>
          </Card>

          {/* Connect another placeholder */}
          <button className="border-2 border-dashed border-ink-300 rounded-xl p-6 flex flex-col items-center justify-center text-ink-400 hover:border-brand-600 hover:text-brand-600 transition-all group bg-ink-50/50 cursor-pointer">
            <div className="w-10 h-10 rounded-full border border-ink-300 group-hover:border-brand-600 flex items-center justify-center mb-3 transition-colors">
              <Plus className="w-5 h-5" strokeWidth={2} />
            </div>
            <span className="text-sm font-semibold">Connect another</span>
            <span className="text-xs mt-1 text-ink-400">
              More OAuth providers coming soon
            </span>
          </button>
        </div>
      </section>

      {/* Divider */}
      <div className="border-t border-ink-200 my-10" />

      {/* Manual key entry */}
      <section className="animate-slide-up">
        <div className="mb-6">
          <h2 className="text-lg font-semibold text-ink-900">
            Manual key entry
          </h2>
          <p className="text-ink-500 text-sm">
            8 providers supported via API key entry
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {MANUAL_PROVIDERS.map((p) => {
            const configured = manual.find((m: any) => m.provider === p.key)
            const isConfigured = Boolean(configured)

            return (
              <Card
                key={p.key}
                className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md"
              >
                <CardBody className="p-5">
                  <div className="flex justify-between items-center mb-4">
                    <span
                      className={`font-semibold text-sm ${
                        isConfigured ? "text-ink-900" : "text-ink-400"
                      }`}
                    >
                      {p.label}
                    </span>
                    {isConfigured ? (
                      <CheckCircle2
                        className="w-4.5 h-4.5 text-success-500 fill-success-500"
                        strokeWidth={0}
                        style={{ fill: "currentColor" }}
                      />
                    ) : (
                      <Circle className="w-4.5 h-4.5 text-ink-300" strokeWidth={1.5} />
                    )}
                  </div>

                  <div className="text-[11px] mb-4">
                    {isConfigured ? (
                      <span className="text-ink-500">
                        <span className="uppercase font-bold tracking-tight">
                          Locales:
                        </span>{" "}
                        {configured?.supported_locales
                          ? (configured.supported_locales as string[]).join(", ")
                          : p.locale ?? "—"}
                      </span>
                    ) : (
                      <span className="text-ink-400">Not configured</span>
                    )}
                  </div>

                  <Link
                    href={`/providers/${p.key}`}
                    className="text-brand-600 hover:text-brand-700 text-xs font-semibold flex items-center gap-1 transition-colors"
                  >
                    {isConfigured ? "Edit keys" : "Add keys"}
                    <ChevronRight className="w-3.5 h-3.5" />
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
    <div className="flex items-center justify-between text-xs gap-3">
      <span className="text-ink-500">{label}</span>
      <span className="text-ink-700">{children}</span>
    </div>
  )
}
