import Link from "next/link"
import { Check, X } from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { ButtonLink } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

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

const FEATURE_ROWS = [
  { label: "Active subscribers", key: "max_active_subscribers" as const },
  {
    label: "Webhook events / month",
    key: "max_webhook_events_per_month" as const,
  },
  { label: "Connected providers", key: "max_connected_providers" as const },
  { label: "Products", key: "max_products" as const },
  { label: "Dashboard team members", key: "max_dashboard_users" as const },
  {
    label: "Analytics retention",
    key: "analytics_retention_days" as const,
    formatter: (v: number) => `${v} days`,
  },
]

const ENTITLEMENT_ROWS = [
  { label: "Multi-provider bottom sheet", gate: "multi_provider" },
  { label: "Remove PayCraft attribution", gate: "remove_attribution" },
  { label: "90-day analytics retention", gate: "analytics_90day" },
  { label: "Unlimited team members", gate: "team_size_unlimited" },
  { label: "Custom paywall branding", gate: "custom_branding" },
  { label: "Self-host Enterprise license", gate: "self_host_license" },
]

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
    <>
      <section className="relative pt-24 pb-12">
        <div className="absolute inset-0 -z-10 bg-gradient-to-b from-brand-50/30 via-white to-white" />
        <div className="max-w-3xl mx-auto px-6 text-center animate-fade-in">
          <p className="text-2xs uppercase font-semibold tracking-widest text-brand-600 mb-2">
            Pricing
          </p>
          <h1 className="text-5xl font-bold tracking-tight text-ink-900 text-balance">
            Start free. Pay as you grow.
          </h1>
          <p className="text-lg text-ink-500 mt-6 text-pretty leading-relaxed">
            Free forever for small apps. Pro for growing teams. Enterprise when
            you need self-host or a signed DPA.
          </p>
        </div>
      </section>

      {/* Tier cards */}
      <section className="pb-16">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-6 items-stretch animate-slide-up">
            {free && <FreeCard tier={free} />}
            {pro && <ProCard tier={pro} />}
            {enterprise && <EnterpriseCard tier={enterprise} />}
          </div>
        </div>
      </section>

      {/* Comparison table */}
      <section className="pb-24">
        <div className="max-w-5xl mx-auto px-6">
          <div className="rounded-2xl border border-ink-200 overflow-hidden bg-white">
            <table className="w-full text-sm">
              <thead className="bg-ink-50 border-b border-ink-200">
                <tr>
                  <th className="px-6 py-4 text-left text-2xs font-bold text-ink-500 uppercase tracking-widest">
                    Compare
                  </th>
                  <th className="px-6 py-4 text-center text-2xs font-bold text-ink-500 uppercase tracking-widest">
                    Free
                  </th>
                  <th className="px-6 py-4 text-center text-2xs font-bold text-brand-700 uppercase tracking-widest bg-brand-50/70">
                    Pro
                  </th>
                  <th className="px-6 py-4 text-center text-2xs font-bold text-ink-500 uppercase tracking-widest">
                    Enterprise
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                <tr>
                  <td
                    colSpan={4}
                    className="px-6 py-2 text-2xs font-bold uppercase tracking-widest text-ink-400 bg-ink-50/30"
                  >
                    Usage limits
                  </td>
                </tr>
                {FEATURE_ROWS.map((row) => (
                  <tr key={row.label}>
                    <td className="px-6 py-3 text-ink-700">{row.label}</td>
                    <td className="px-6 py-3 text-center text-ink-700 tabular-nums">
                      {formatLimit(free?.[row.key], row.formatter)}
                    </td>
                    <td className="px-6 py-3 text-center text-ink-700 tabular-nums bg-brand-50/30">
                      {formatLimit(pro?.[row.key], row.formatter)}
                    </td>
                    <td className="px-6 py-3 text-center text-ink-700 tabular-nums">
                      {formatLimit(enterprise?.[row.key], row.formatter)}
                    </td>
                  </tr>
                ))}
                <tr>
                  <td
                    colSpan={4}
                    className="px-6 py-2 text-2xs font-bold uppercase tracking-widest text-ink-400 bg-ink-50/30"
                  >
                    Features
                  </td>
                </tr>
                {ENTITLEMENT_ROWS.map((row) => (
                  <tr key={row.gate}>
                    <td className="px-6 py-3 text-ink-700">{row.label}</td>
                    <Check3 ent={free?.entitlements} gate={row.gate} />
                    <Check3
                      ent={pro?.entitlements}
                      gate={row.gate}
                      highlight
                    />
                    <Check3 ent={enterprise?.entitlements} gate={row.gate} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="text-center mt-12 text-xs text-ink-500">
            Questions about pricing?{" "}
            <Link
              href="mailto:sales@paycraft.cloud"
              className="text-brand-600 hover:text-brand-700 font-medium"
            >
              sales@paycraft.cloud
            </Link>
          </div>
        </div>
      </section>
    </>
  )
}

function FreeCard({ tier }: { tier: Tier }) {
  return (
    <div className="rounded-2xl border border-ink-200 bg-white p-6 flex flex-col">
      <div className="text-sm font-semibold text-ink-700">
        {tier.display_name}
      </div>
      <div className="mt-3 flex items-baseline">
        <span className="text-4xl font-bold tracking-tight tabular-nums">
          $0
        </span>
        <span className="ml-2 text-sm text-ink-500">forever</span>
      </div>
      <p className="text-xs text-ink-500 mt-2">
        For experiments and side projects. No card required.
      </p>
      <ul className="mt-6 space-y-2.5 text-sm flex-1">
        <Feature>
          <span className="tabular-nums">
            {tier.max_active_subscribers}
          </span>{" "}
          active subscribers
        </Feature>
        <Feature>
          <span className="tabular-nums">
            {tier.max_webhook_events_per_month?.toLocaleString()}
          </span>{" "}
          webhook events / mo
        </Feature>
        <Feature>1 connected provider</Feature>
        <Feature>1 product</Feature>
        <Feature>
          <span className="tabular-nums">
            {tier.analytics_retention_days}
          </span>
          -day analytics retention
        </Feature>
        <Disabled>Remove PayCraft attribution footer</Disabled>
      </ul>
      <ButtonLink
        href="/auth/signup"
        variant="secondary"
        size="lg"
        className="mt-8 w-full justify-center"
      >
        Start free
      </ButtonLink>
    </div>
  )
}

function ProCard({ tier }: { tier: Tier }) {
  return (
    <div className="relative rounded-2xl bg-white p-6 flex flex-col ring-2 ring-brand-500 shadow-xl shadow-brand-500/15 md:scale-[1.03] md:-my-1">
      <div className="absolute -top-3 left-1/2 -translate-x-1/2">
        <Badge tone="brand" className="!shadow-md">
          Most popular
        </Badge>
      </div>
      <div className="text-sm font-semibold text-brand-700">
        {tier.display_name}
      </div>
      <div className="mt-3 flex items-baseline">
        <span className="text-4xl font-bold tracking-tight tabular-nums">
          ${(tier.base_price_cents / 100).toFixed(0)}
        </span>
        <span className="ml-2 text-sm text-ink-500">/ month</span>
      </div>
      <p className="text-xs text-ink-500 mt-2">
        + $
        {(tier.metered_per_subscriber_cents / 100).toFixed(2)} per subscriber
        over {tier.max_active_subscribers?.toLocaleString()}.
      </p>
      <ul className="mt-6 space-y-2.5 text-sm flex-1">
        <Feature>
          <span className="tabular-nums">
            {tier.max_active_subscribers?.toLocaleString()}
          </span>{" "}
          subscribers (then metered)
        </Feature>
        <Feature>Unlimited webhook events</Feature>
        <Feature>Unlimited providers + products</Feature>
        <Feature>Unlimited team members</Feature>
        <Feature>
          <span className="tabular-nums">
            {tier.analytics_retention_days}
          </span>
          -day analytics retention
        </Feature>
        <Feature>Remove PayCraft attribution</Feature>
      </ul>
      <ButtonLink
        href="/auth/signup?plan=pro"
        size="lg"
        className="mt-8 w-full justify-center"
      >
        Start Pro trial
      </ButtonLink>
    </div>
  )
}

function EnterpriseCard({ tier }: { tier: Tier }) {
  return (
    <div className="rounded-2xl border border-ink-200 bg-white p-6 flex flex-col">
      <div className="text-sm font-semibold text-ink-700">
        {tier.display_name}
      </div>
      <div className="mt-3 flex items-baseline">
        <span className="text-4xl font-bold tracking-tight">Custom</span>
      </div>
      <p className="text-xs text-ink-500 mt-2">
        Self-host license, custom branding, signed DPA.
      </p>
      <ul className="mt-6 space-y-2.5 text-sm flex-1">
        <Feature>Everything in Pro, no limits</Feature>
        <Feature>Self-host (BSL license)</Feature>
        <Feature>Custom paywall branding</Feature>
        <Feature>
          <span className="tabular-nums">
            {tier.analytics_retention_days}
          </span>
          -day analytics retention
        </Feature>
        <Feature>Priority support + SLA</Feature>
        <Feature>SOC 2 / GDPR / DPA package</Feature>
      </ul>
      <ButtonLink
        href="mailto:sales@paycraft.cloud"
        variant="secondary"
        size="lg"
        className="mt-8 w-full justify-center"
      >
        Contact sales
      </ButtonLink>
    </div>
  )
}

function Feature({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-ink-700">
      <span className="w-4 h-4 rounded-full bg-success-100 text-success-700 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Check className="w-2.5 h-2.5" strokeWidth={3} />
      </span>
      <span>{children}</span>
    </li>
  )
}

function Disabled({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2 text-ink-400">
      <span className="w-4 h-4 rounded-full bg-ink-100 text-ink-400 flex items-center justify-center flex-shrink-0 mt-0.5">
        <X className="w-2.5 h-2.5" strokeWidth={3} />
      </span>
      <span>{children}</span>
    </li>
  )
}

function Check3({
  ent,
  gate,
  highlight,
}: {
  ent: string[] | undefined
  gate: string
  highlight?: boolean
}) {
  const has = ent?.includes(gate) ?? false
  return (
    <td
      className={`px-6 py-3 text-center ${
        highlight ? "bg-brand-50/30" : ""
      }`}
    >
      {has ? (
        <Check
          className="inline-block w-4 h-4 text-success-600"
          strokeWidth={3}
        />
      ) : (
        <span className="text-ink-300">—</span>
      )}
    </td>
  )
}

function formatLimit(
  value: number | null | undefined,
  formatter?: (v: number) => string,
): React.ReactNode {
  if (value === null || value === undefined) {
    return <span className="text-ink-400">∞</span>
  }
  if (formatter) return formatter(value)
  return value.toLocaleString()
}
