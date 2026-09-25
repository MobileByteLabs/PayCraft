export const runtime = "edge"

import type { Metadata } from "next"
import Link from "next/link"
import { createClient } from "@/lib/supabase-server"
import { ButtonLink } from "@/components/ui/button"

/**
 * Pricing, rebuilt from idea-layer/screens/pricing/ui.yaml and its Stitch mockup.
 *
 * The page has an unusual burden for a billing product: it must make clear that PayCraft never
 * takes a percentage of the revenue it processes. The subscription buys the hosted dashboard and
 * its limits; the money itself always flows provider to your account. A reader who leaves unsure
 * about that has not been sold the product, which is why the zero-revenue-share callout sits
 * between the cards and the matrix where it cannot be scrolled past, and why the revenue-share
 * row is the FIRST row of the comparison table.
 *
 * Tier figures still come from Supabase `tier_definitions`, exactly as before. Hardcoding them
 * here would make this page a second source of truth for what a plan costs, and the two would
 * drift the first time a price changed.
 */

export const metadata: Metadata = {
  title: "PayCraft pricing",
  description:
    "PayCraft never takes a percentage. Your provider pays you directly, and the plan covers the hosted dashboard and its limits, nothing else.",
}

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

/** `null` means unlimited in tier_definitions. Render that, never a bare "null" or a 0. */
const cap = (v: number | null | undefined) =>
  v === null || v === undefined ? "Unlimited" : v.toLocaleString()

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div className="font-mono text-2xs font-semibold uppercase tracking-[0.08em] text-ink-500">
      {children}
    </div>
  )
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

  // 29 is the shipped fallback the previous page used when tier_definitions is unreachable.
  const proPrice = pro ? Math.round(pro.base_price_cents / 100) : 29

  const cards = [
    {
      name: "Free",
      price: "$0",
      cadence: "forever",
      for: "Shipping your first app",
      cta: { label: "Start free", href: "/auth/login" },
      emphasis: false,
      points: [
        `${cap(free?.max_active_subscribers)} active subscribers`,
        `${cap(free?.max_connected_providers)} connected providers`,
        `${cap(free?.max_products)} products`,
        "Every provider, including the stores",
      ],
    },
    {
      name: "Pro",
      price: `$${proPrice}`,
      cadence: "per month",
      for: "Teams running several apps",
      cta: { label: "Upgrade", href: "/auth/login" },
      emphasis: true,
      points: [
        "Unlimited webhook events",
        "Unlimited providers",
        "Unlimited products",
        "Unlimited dashboard users",
      ],
    },
    {
      name: "Enterprise",
      price: "Custom",
      cadence: "",
      for: "Volume, procurement, support terms",
      cta: { label: "Talk to us", href: "/docs" },
      emphasis: false,
      points: [
        "Everything in Pro",
        `${enterprise?.analytics_retention_days ?? 365} day analytics retention`,
        "Support terms and invoicing",
        "Self-host with support",
      ],
    },
  ]

  const matrix = [
    { row: "Revenue share taken by PayCraft", free: "None", pro: "None", ent: "None" },
    {
      row: "Webhook events",
      free: cap(free?.max_webhook_events_per_month),
      pro: "Unlimited",
      ent: "Unlimited",
    },
    {
      row: "Connected providers",
      free: cap(free?.max_connected_providers),
      pro: "Unlimited",
      ent: "Unlimited",
    },
    { row: "Products", free: cap(free?.max_products), pro: "Unlimited", ent: "Unlimited" },
    {
      row: "Dashboard users",
      free: cap(free?.max_dashboard_users),
      pro: "Unlimited",
      ent: "Unlimited",
    },
    { row: "Self-host instead", free: "Yes", pro: "Yes", ent: "Yes" },
  ]

  const faq = [
    {
      q: "Do you take a cut of my subscription revenue?",
      a: "No. Not on any tier, including free.",
    },
    {
      q: "Where does the money actually go?",
      a: "From the provider straight to your account. PayCraft is never in the money path.",
    },
    {
      q: "What happens if I stop paying?",
      a: "The hosted dashboard reverts to free limits. Your data stays yours and can be exported or self-hosted at any point.",
    },
    { q: "Is there a trial?", a: "Free is not a trial. It does not expire." },
  ]

  return (
    <div className="mx-auto max-w-6xl px-6">
      <section className="border-b border-ink-200 py-16 text-center">
        <Eyebrow>Pricing</Eyebrow>
        <h1 className="mt-4 text-balance text-4xl font-semibold tracking-[-0.025em] text-ink-950 md:text-5xl">
          Pay for the dashboard, not the revenue
        </h1>
        {/* The single differentiator of the whole product. Base text colour, never muted: a grey
            subhead here would bury the one sentence the page exists to deliver. */}
        <p className="mx-auto mt-5 max-w-[60ch] text-lg leading-relaxed text-ink-800">
          PayCraft never takes a percentage. Your provider pays you directly, and the plan covers
          the hosted dashboard and its limits, nothing else.
        </p>
      </section>

      {/* ── Tiers ────────────────────────────────────────────────────────────
          Pro is raised by BORDER COLOUR and a small tag only. A violet fill
          would shout on a page whose whole argument is restraint. */}
      <section className="py-14">
        <div className="grid gap-5 md:grid-cols-3">
          {cards.map((t) => (
            <div
              key={t.name}
              className={`flex flex-col rounded-xl border bg-white p-6 ${
                t.emphasis ? "border-brand-500" : "border-ink-200"
              }`}
            >
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-ink-900">{t.name}</h2>
                {t.emphasis && (
                  <span className="rounded-full border border-brand-300 px-2.5 py-0.5 font-mono text-2xs font-semibold uppercase tracking-[0.06em] text-brand-700">
                    Most teams
                  </span>
                )}
              </div>
              <div className="mt-5 flex items-baseline gap-1.5">
                <span className="text-4xl font-semibold tabular-nums tracking-tight text-ink-950">
                  {t.price}
                </span>
                {t.cadence && <span className="text-sm text-ink-500">{t.cadence}</span>}
              </div>
              <p className="mt-2 text-sm text-ink-500">{t.for}</p>
              <ul className="mt-6 flex-1 space-y-2.5 text-sm text-ink-700">
                {t.points.map((p) => (
                  <li key={p} className="flex gap-2.5">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
              <ButtonLink
                href={t.cta.href}
                variant={t.emphasis ? "primary" : "secondary"}
                className="mt-7 w-full justify-center"
              >
                {t.cta.label}
              </ButtonLink>
            </div>
          ))}
        </div>
      </section>

      {/* ── The answer everyone arrives with ─────────────────────────────────
          Placed between the cards and the matrix so it cannot be scrolled past. */}
      <section className="pb-14">
        <div className="rounded-xl border border-brand-200 bg-brand-50 p-6 md:p-8">
          <h2 className="text-lg font-semibold text-ink-900">
            Zero revenue share, on every tier
          </h2>
          <p className="mt-2 max-w-[70ch] text-ink-700">
            Stripe, Razorpay, Play and the App Store settle directly to your account. PayCraft
            never sits in the money path and never holds funds, which is also why it is out of PCI
            scope.
          </p>
        </div>
      </section>

      {/* ── Matrix. Revenue share is row one, reading None across. ───────── */}
      <section className="border-t border-ink-200 py-14">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-200">
                {["", "Free", "Pro", "Enterprise"].map((h, i) => (
                  <th
                    key={h || i}
                    className={`py-3 font-mono text-2xs font-semibold uppercase tracking-[0.07em] text-ink-500 ${
                      i === 0 ? "text-left" : "text-center"
                    }`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.map((r) => (
                <tr key={r.row} className="border-b border-ink-200 last:border-0">
                  <td className="py-4 pr-4 text-ink-800">{r.row}</td>
                  <td className="py-4 text-center tabular-nums text-ink-700">{r.free}</td>
                  <td className="py-4 text-center tabular-nums text-ink-700">{r.pro}</td>
                  <td className="py-4 text-center tabular-nums text-ink-700">{r.ent}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="border-t border-ink-200 py-14">
        <div className="rounded-xl border border-ink-200 bg-ink-50 p-6 md:p-8">
          <h2 className="text-lg font-semibold text-ink-900">Or host it yourself</h2>
          <p className="mt-2 max-w-[70ch] text-ink-600">
            Every tier can be replaced by your own Supabase project. The SDK is Apache-2.0 and the
            schema and edge functions ship in the repo. Self-hosting costs nothing and is not a
            downgrade: you lose the hosted dashboard, not the product.
          </p>
          <Link
            href="/self-host"
            className="mt-4 inline-block text-sm font-medium text-brand-700 underline underline-offset-4"
          >
            Self-hosting guide
          </Link>
        </div>
      </section>

      <section className="border-t border-ink-200 py-14">
        <h2 className="mb-8 text-2xl font-semibold tracking-tight text-ink-900">Questions</h2>
        <div className="grid gap-x-10 gap-y-7 md:grid-cols-2">
          {faq.map((f) => (
            <div key={f.q}>
              <h3 className="font-medium text-ink-900">{f.q}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{f.a}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
