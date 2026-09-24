export const runtime = "edge"

import Link from "next/link"
import { notFound } from "next/navigation"
import { KeyRound } from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { Badge } from "@/components/ui/badge"
import { Card, CardBody } from "@/components/ui/card"
import { CopyButton } from "@/components/ui/copy-button"

/**
 * App detail — the drill-down from the account overview.
 *
 * THE DATA MODEL THIS SCREEN HAS TO TEACH, verified against the schema: `provider_accounts` keys
 * on `owner_user_id` (the ACCOUNT) while products, subscriptions, coupons and webhooks all key on
 * `tenant_id` (the APP). Providers are therefore connected ONCE per account and shared by every
 * app, and this screen is the place a user is most likely to reach for a provider control that
 * does not belong here.
 *
 * So the provider block is READ-ONLY by construction: no edit control, no disconnect button, no
 * credential field, and a single link up to account level. Rendering an editable-looking provider
 * row here would teach the exact opposite of the schema.
 *
 * Everything the previous 105-line version showed is preserved: plan badge, products count,
 * subscribers count, and the two publishable API keys with copy buttons. What is added is the
 * capability grid (what this app can actually DO) and the inherited-provider block.
 */

const PROVIDER_LABELS: Record<string, string> = {
  stripe: "Stripe",
  razorpay: "Razorpay",
  cashfree: "Cashfree",
  google_play: "Google Play",
  app_store: "App Store",
  upi: "UPI",
}

export default async function AppDetailPage({ params }: { params: { id: string } }) {
  const supabase = createClient()

  // AUTHORIZATION, unchanged from the page this replaces. Membership in tenant_admins is checked
  // BEFORE the tenant row is read, so a signed-in user cannot read another account's app by
  // guessing its id. `getUserApps()` would also scope correctly, but it does not return the
  // publishable keys, and widening it just for this page would widen it for every caller.
  const { data: membership } = await supabase
    .from("tenant_admins")
    .select("role")
    .eq("tenant_id", params.id)
    .maybeSingle()
  if (!membership) notFound()

  const { data: app } = await supabase.from("tenants").select("*").eq("id", params.id).single()
  if (!app) notFound()

  const [productsRes, subsRes, providersRes, couponsRes, paywallRes] = await Promise.all([
    supabase.from("tenant_products").select("id, active").eq("tenant_id", params.id),
    supabase.from("subscriptions").select("id, status").eq("tenant_id", params.id),
    supabase.from("tenant_providers").select("provider, is_active").eq("tenant_id", params.id),
    supabase.from("tenant_coupons").select("id").eq("tenant_id", params.id),
    supabase.from("tenant_offerings").select("id").eq("tenant_id", params.id),
  ])

  const products = productsRes.data ?? []
  const activeProducts = products.filter((p) => p.active).length
  const subscriptions = subsRes.data ?? []
  const activeSubs = subscriptions.filter((s) => s.status === "active" || s.status === "trialing").length
  const providers = providersRes.data ?? []
  const couponCount = (couponsRes.data ?? []).length
  const offeringCount = (paywallRes.data ?? []).length

  // Capabilities are derived from what this app has actually CONFIGURED, never hardcoded to "on".
  // A bare toggle would say nothing; the detail line is what makes the card worth reading.
  const capabilities = [
    {
      name: "Subscriptions",
      on: activeProducts > 0,
      detail: activeProducts > 0 ? `${activeProducts} active product${activeProducts === 1 ? "" : "s"}` : "no active products yet",
      href: "/products",
    },
    {
      name: "Entitlements",
      on: activeSubs > 0,
      detail: activeSubs > 0 ? "canonical state resolved server-side" : "no active subscribers yet",
      href: "/subscribers",
    },
    {
      name: "Paywall",
      on: offeringCount > 0,
      detail: offeringCount > 0 ? `${offeringCount} offering${offeringCount === 1 ? "" : "s"} published` : "not configured",
      href: "/paywall",
    },
    {
      name: "Coupons",
      on: couponCount > 0,
      detail: couponCount > 0 ? `${couponCount} code${couponCount === 1 ? "" : "s"}` : "no codes yet",
      href: "/coupons",
    },
    {
      name: "Analytics",
      on: activeSubs > 0,
      detail: activeSubs > 0 ? "revenue and churn" : "needs subscriber data",
      href: "/analytics",
    },
    {
      name: "UPI payments",
      on: providers.some((p) => p.provider === "upi" && p.is_active),
      detail: providers.some((p) => p.provider === "upi") ? "reconciliation required" : "available via Razorpay",
      href: "/upi-payments",
    },
  ]

  return (
    <div>
      {/* The breadcrumb is what stops an app reading as a top-level scope. */}
      <nav className="pt-10 text-sm text-ink-500">
        <Link href="/dashboard" className="hover:text-ink-800 hover:underline">
          Account overview
        </Link>
        <span className="mx-2 text-ink-300">/</span>
        <span className="text-ink-700">{app.name}</span>
      </nav>

      <header className="mb-8 mt-4">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight text-ink-950">{app.name}</h1>
          <Badge tone={app.plan === "pro" ? "success" : "neutral"}>{app.plan}</Badge>
        </div>
        <p className="mt-1.5 text-sm text-ink-500">App overview and credentials</p>
      </header>

      {/* Four flat peers. No gradient hero, no drop shadow. */}
      <section className="mb-10">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-ink-200 bg-ink-200 lg:grid-cols-4">
          {[
            { label: "Products", value: String(products.length), note: `${activeProducts} active` },
            { label: "Active subscribers", value: activeSubs.toLocaleString(), note: `${subscriptions.length} total records` },
            { label: "Providers", value: String(providers.length), note: "inherited from account" },
            { label: "Coupons", value: String(couponCount), note: couponCount === 0 ? "none yet" : "discount codes" },
          ].map((m) => (
            <div key={m.label} className="bg-white px-5 py-5">
              <div className="font-mono text-2xs font-semibold uppercase tracking-[0.08em] text-ink-500">
                {m.label}
              </div>
              <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-ink-950">
                {m.value}
              </div>
              <div className="mt-1 text-xs text-ink-500">{m.note}</div>
            </div>
          ))}
        </div>
      </section>

      {/* ── API keys: preserved from the page this replaces ──────────────────
          These are PUBLISHABLE keys and are safe on screen, so they render
          plainly. A masked-secret treatment would wrongly imply they must be
          hidden. The secret pcsk_ management keys live at account level under
          Settings → Developer API and are deliberately absent here. */}
      <section className="mb-10">
        <Card>
          <div className="flex items-center gap-2 border-b border-ink-200 px-5 py-3">
            <KeyRound className="h-4 w-4 text-ink-400" />
            <h2 className="font-mono text-2xs font-semibold uppercase tracking-[0.08em] text-ink-500">
              API keys
            </h2>
          </div>
          <CardBody className="space-y-4 p-5">
            {[
              { label: "Live publishable key", value: app.api_key_live },
              { label: "Test publishable key", value: app.api_key_test },
            ].map((k) => (
              <div key={k.label} className="space-y-1.5">
                <label className="block font-mono text-2xs font-semibold uppercase tracking-[0.08em] text-ink-500">
                  {k.label}
                </label>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-lg border border-ink-200 bg-ink-50 px-3 py-2 font-mono text-xs text-ink-700">
                    {k.value}
                  </code>
                  <CopyButton value={k.value} />
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      </section>

      {/* ── Capabilities: what this app can actually do ──────────────────────
          Off cards stay fully neutral and are NOT dimmed away. An
          available-but-unused capability is a discovery surface, not an error. */}
      <section className="mb-10">
        <h2 className="mb-3 font-mono text-2xs font-semibold uppercase tracking-[0.08em] text-ink-500">
          Capabilities
        </h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((c) => (
            <Link
              key={c.name}
              href={c.href}
              className="rounded-xl border border-ink-200 bg-white p-4 transition-colors hover:border-brand-400"
            >
              <div className="flex items-center justify-between">
                <span className="font-medium text-ink-900">{c.name}</span>
                <span className="inline-flex items-center gap-1.5 text-xs text-ink-500">
                  <span className={`h-1.5 w-1.5 rounded-full ${c.on ? "bg-success-500" : "bg-ink-300"}`} />
                  {c.on ? "On" : "Off"}
                </span>
              </div>
              <p className="mt-1.5 text-sm text-ink-500">{c.detail}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* ── Inherited providers: READ-ONLY by construction ───────────────────
          Deliberately quieter than the account matrix: inset, no hover, no
          control of any kind. provider_accounts keys on owner_user_id, so these
          genuinely are not this app's to change. */}
      <section className="mb-12">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <div>
            <h2 className="font-mono text-2xs font-semibold uppercase tracking-[0.08em] text-ink-500">
              Providers
            </h2>
            <p className="mt-1 text-sm text-ink-500">
              Inherited from the account. Manage connections at account level.
            </p>
          </div>
          <Link
            href="/settings/provider-accounts"
            className="shrink-0 text-xs font-semibold text-brand-700 hover:underline"
          >
            Manage at account level →
          </Link>
        </div>
        {providers.length === 0 ? (
          <div className="rounded-xl border border-ink-200 bg-ink-50 px-5 py-6 text-sm text-ink-500">
            No providers connected to this app yet. Connections are made once at account level and
            then shared.
          </div>
        ) : (
          <div className="divide-y divide-ink-200 rounded-xl border border-ink-200 bg-ink-50">
            {providers.map((p) => (
              <div key={p.provider} className="flex items-center justify-between px-5 py-3.5">
                <div className="flex items-center gap-2.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${p.is_active ? "bg-success-500" : "bg-ink-300"}`} />
                  <span className="text-sm font-medium text-ink-800">
                    {PROVIDER_LABELS[p.provider] ?? p.provider}
                  </span>
                  {(p.provider === "google_play" || p.provider === "app_store") && (
                    <span
                      className="text-xs text-ink-500"
                      title="Neither store exposes an API to enable sandbox testing. Test mode turns ready when a real sandbox purchase arrives."
                    >
                      test: manual step
                    </span>
                  )}
                </div>
                <span className="rounded-full border border-ink-200 bg-white px-2 py-0.5 font-mono text-2xs uppercase tracking-wider text-ink-500">
                  Account connection
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}
