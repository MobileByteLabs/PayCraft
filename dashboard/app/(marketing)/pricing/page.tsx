import Link from "next/link"
import { Check, CheckCircle2 } from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { ButtonLink } from "@/components/ui/button"

interface Tier {
  tier_name: "free" | "pro" | "enterprise"
  display_name: string
  max_active_subscribers: number | null
  max_webhook_events_per_month: number | null
  max_connected_providers: number | null
  max_products: number | null
  max_dashboard_users: number | null
  analytics_retention_days: number
  attribution_required: boolean
  entitlements: string[]
  base_price_cents: number
  base_currency: string
  metered_per_subscriber_cents: number
}

export default async function PricingPage() {
  const supabase = createClient()
  const { data } = await supabase
    .from("tier_definitions")
    .select("*")
    .in("tier_name", ["free", "pro", "enterprise"])
    .order("base_price_cents", { ascending: true })

  const tiersByName = (data ?? []).reduce<Record<string, Tier>>((acc, t) => {
    acc[t.tier_name] = t as Tier
    return acc
  }, {})

  const free = tiersByName["free"]
  const pro = tiersByName["pro"]
  const enterprise = tiersByName["enterprise"]

  return (
    <main className="pt-24 pb-24 px-6">
      {/* Hero */}
      <section className="max-w-4xl mx-auto text-center mb-20">
        <h1 className="text-5xl md:text-6xl font-extrabold text-ink-950 tracking-tighter mb-6">
          Pricing
        </h1>
        <p className="text-xl text-ink-500">Start free. Pay as you grow.</p>
      </section>

      {/* Pricing Cards */}
      <section className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 mb-24 items-center">
        {/* Free */}
        <div className="bg-white border border-ink-200 rounded-xl p-8 flex flex-col transition-all hover:shadow-md hover:-translate-y-1">
          <div className="mb-8">
            <h3 className="text-lg font-bold text-ink-950 mb-2">Free</h3>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-extrabold text-ink-950">
                {free ? "$0" : "$0"}
              </span>
            </div>
            <p className="text-sm text-ink-500 mt-2">Forever, no card required</p>
          </div>

          <ul className="space-y-4 mb-10 flex-grow">
            <FeatureItem>
              {free?.max_active_subscribers ?? 100} active subscribers
            </FeatureItem>
            <FeatureItem>
              {(free?.max_webhook_events_per_month ?? 10000).toLocaleString()} webhook events/month
            </FeatureItem>
            <FeatureItem>1 connected provider</FeatureItem>
            <FeatureItem>1 product</FeatureItem>
            <FeatureItem>
              {free?.max_dashboard_users ?? 3} dashboard users
            </FeatureItem>
            <FeatureItem>
              {free?.analytics_retention_days ?? 7}-day analytics retention
            </FeatureItem>
            <InfoItem>Attribution footer required</InfoItem>
          </ul>

          <ButtonLink
            href="/auth/login"
            variant="secondary"
            size="lg"
            className="w-full justify-center border-2 border-brand-600 !text-brand-600 hover:!bg-brand-600 hover:!text-white transition-all"
          >
            Start free
          </ButtonLink>
        </div>

        {/* Pro — featured */}
        <div className="relative bg-white border-2 border-brand-600 rounded-xl p-8 flex flex-col shadow-xl shadow-brand-500/10 scale-105 z-10">
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-brand-600 text-white text-[10px] font-bold tracking-widest px-3 py-1 rounded-full">
            MOST POPULAR
          </div>

          <div className="mb-8">
            <h3 className="text-lg font-bold text-ink-950 mb-2">Pro</h3>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-extrabold text-ink-950">
                ${pro ? Math.round(pro.base_price_cents / 100) : 29}
              </span>
              <span className="text-sm text-ink-500">/month</span>
            </div>
            <p className="text-[12px] text-ink-500 mt-2 leading-tight">
              + ${pro ? (pro.metered_per_subscriber_cents / 100).toFixed(2) : "0.10"} per subscriber over{" "}
              {(pro?.max_active_subscribers ?? 1000).toLocaleString()}
            </p>
          </div>

          <ul className="space-y-4 mb-10 flex-grow">
            <ProFeatureItem>
              {(pro?.max_active_subscribers ?? 1000).toLocaleString()} subscribers included
            </ProFeatureItem>
            <ProFeatureItem>Unlimited webhook events</ProFeatureItem>
            <ProFeatureItem>Unlimited providers</ProFeatureItem>
            <ProFeatureItem>Unlimited products</ProFeatureItem>
            <ProFeatureItem>Unlimited dashboard users</ProFeatureItem>
            <ProFeatureItem>
              {pro?.analytics_retention_days ?? 90}-day analytics retention
            </ProFeatureItem>
            <ProFeatureItem>Remove attribution footer</ProFeatureItem>
          </ul>

          <ButtonLink
            href="/auth/login"
            size="lg"
            className="w-full justify-center shadow-lg shadow-brand-500/25"
          >
            Start Pro trial
          </ButtonLink>
        </div>

        {/* Enterprise */}
        <div className="bg-white border border-ink-200 rounded-xl p-8 flex flex-col transition-all hover:shadow-md hover:-translate-y-1">
          <div className="mb-8">
            <h3 className="text-lg font-bold text-ink-950 mb-2">Enterprise</h3>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-extrabold text-ink-950">Custom</span>
            </div>
            <p className="text-sm text-ink-500 mt-2">Self-host license included</p>
          </div>

          <ul className="space-y-4 mb-10 flex-grow">
            <FeatureItem>Everything in Pro (unlimited)</FeatureItem>
            <FeatureItem>Self-host (BSL license)</FeatureItem>
            <FeatureItem>Custom paywall branding</FeatureItem>
            <FeatureItem>
              {enterprise?.analytics_retention_days ?? 365}-day analytics retention
            </FeatureItem>
            <FeatureItem>Priority support + SLA</FeatureItem>
            <FeatureItem>SOC 2 / GDPR compliance package</FeatureItem>
          </ul>

          <ButtonLink
            href="mailto:sales@paycraft.mobilebytesensei.com"
            variant="secondary"
            size="lg"
            className="w-full justify-center border-2 border-ink-900 !text-ink-900 hover:!bg-ink-900 hover:!text-white transition-all"
          >
            Contact sales
          </ButtonLink>
        </div>
      </section>

      {/* Comparison Table */}
      <section className="max-w-7xl mx-auto overflow-x-auto pb-8">
        <h2 className="text-2xl font-bold text-ink-950 mb-8 text-center">
          Feature comparison
        </h2>
        <table className="w-full border-collapse">
          <thead>
            <tr className="text-left border-b border-ink-100">
              <th className="py-6 font-semibold text-ink-500 text-[11px] uppercase tracking-wider w-2/5">
                Feature
              </th>
              <th className="py-6 font-semibold text-ink-500 text-[11px] uppercase tracking-wider text-center">
                Free
              </th>
              <th className="py-6 font-semibold text-ink-500 text-[11px] uppercase tracking-wider text-center">
                Pro
              </th>
              <th className="py-6 font-semibold text-ink-500 text-[11px] uppercase tracking-wider text-center">
                Enterprise
              </th>
            </tr>
          </thead>
          <tbody className="text-[13px]">
            {[
              {
                label: "Included Subscribers",
                free: (free?.max_active_subscribers ?? 100).toLocaleString(),
                pro: (pro?.max_active_subscribers ?? 1000).toLocaleString(),
                enterprise: "Custom",
              },
              {
                label: "Monthly Webhook Events",
                free: (free?.max_webhook_events_per_month ?? 10000).toLocaleString(),
                pro: "Unlimited",
                enterprise: "Unlimited",
              },
              {
                label: "Connected Providers",
                free: String(free?.max_connected_providers ?? 1),
                pro: "Unlimited",
                enterprise: "Unlimited",
              },
              {
                label: "Dashboard Users",
                free: String(free?.max_dashboard_users ?? 3),
                pro: "Unlimited",
                enterprise: "Unlimited",
              },
              {
                label: "Analytics Retention",
                free: `${free?.analytics_retention_days ?? 7} days`,
                pro: `${pro?.analytics_retention_days ?? 90} days`,
                enterprise: `${enterprise?.analytics_retention_days ?? 365} days`,
              },
            ].map((row) => (
              <tr
                key={row.label}
                className="border-b border-ink-100 hover:bg-ink-50 transition-colors"
              >
                <td className="py-5 font-medium text-ink-950">{row.label}</td>
                <td className="py-5 text-center text-ink-600">{row.free}</td>
                <td className="py-5 text-center text-ink-600">{row.pro}</td>
                <td className="py-5 text-center text-ink-600">{row.enterprise}</td>
              </tr>
            ))}

            {/* Boolean feature rows */}
            {[
              { label: "Self-host Option", free: false, pro: false, enterprise: true },
              { label: "Whitelabel Paywall", free: false, pro: true, enterprise: true },
              { label: "Priority Support & SLA", free: false, pro: false, enterprise: true },
            ].map((row) => (
              <tr
                key={row.label}
                className="border-b border-ink-100 hover:bg-ink-50 transition-colors"
              >
                <td className="py-5 font-medium text-ink-950">{row.label}</td>
                <td className="py-5 text-center">
                  {row.free ? <Check className="inline-block w-4 h-4 text-green-500" strokeWidth={2.5} /> : <span className="text-ink-300">—</span>}
                </td>
                <td className="py-5 text-center">
                  {row.pro ? <Check className="inline-block w-4 h-4 text-green-500" strokeWidth={2.5} /> : <span className="text-ink-300">—</span>}
                </td>
                <td className="py-5 text-center">
                  {row.enterprise ? <Check className="inline-block w-4 h-4 text-green-500" strokeWidth={2.5} /> : <span className="text-ink-300">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <div className="text-center mt-12 text-xs text-ink-500">
        Questions about pricing?{" "}
        <Link
          href="mailto:sales@paycraft.mobilebytesensei.com"
          className="text-brand-600 hover:text-brand-700 font-medium"
        >
          sales@paycraft.mobilebytesensei.com
        </Link>
      </div>
    </main>
  )
}

function FeatureItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-sm text-ink-700">
      <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0 mt-0.5" />
      <span>{children}</span>
    </li>
  )
}

function ProFeatureItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-sm text-ink-700">
      <CheckCircle2 className="w-5 h-5 text-brand-600 shrink-0 mt-0.5" />
      <span>{children}</span>
    </li>
  )
}

function InfoItem({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-3 text-sm text-ink-400">
      <span className="w-5 h-5 shrink-0 flex items-center justify-center mt-0.5 text-ink-400">
        <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
        </svg>
      </span>
      <span>{children}</span>
    </li>
  )
}
