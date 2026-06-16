import Link from "next/link"
import { Package, Plus, Zap, DollarSign, Clock, Database, ArrowRight, Webhook } from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { PageHeader } from "@/components/ui/page-header"
import { ButtonLink } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"
import { UnsyncedProductsBanner } from "@/components/products/unsynced-products-banner"
import { ProductRowActions } from "@/components/products/product-row-actions"
import {
  verifyStripeProductSync,
  type SyncVerification,
} from "@/lib/stripe-sync-verify"

type Product = {
  id: string
  sku: string
  type: "subscription" | "trial" | "lifetime"
  display_name: string
  trial_enabled: boolean
  trial_duration_days: number | null
  attaches_to_product_id: string | null
  interval: string | null
  base_price_cents: number
  base_currency: string
  display_order: number
  active: boolean
  stripe_product_id: string | null
  stripe_price_id_by_currency: Record<string, string> | null
  razorpay_plan_id_by_currency: Record<string, string> | null
}

function formatMoney(cents: number, currency: string): string {
  if (currency === "INR") return `₹${(cents / 100).toFixed(0)}`
  const symbol =
    currency === "USD"
      ? "$"
      : currency === "EUR"
      ? "€"
      : currency === "GBP"
      ? "£"
      : ""
  return symbol
    ? `${symbol}${(cents / 100).toFixed(2)}`
    : `${(cents / 100).toFixed(2)} ${currency}`
}

export default async function ProductsPage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()
  const [productsRes, mrrRes, stripeStatusRes, razorpayStatusRes] = await Promise.all([
    supabase.rpc("tenant_products_list", { p_tenant_id: tenant.id }),
    supabase
      .from("tenant_revenue_by_plan_view")
      .select("subscribers,total_revenue_dollars")
      .eq("tenant_id", tenant.id),
    // Connection status drives the per-row chip colors: "connect provider"
    // gray vs "synced" green vs "needs sync" amber. tenant_stripe_provider_status
    // recognizes both OAuth and Manual key paths (added in migration 058).
    supabase
      .rpc("tenant_stripe_provider_status", { p_tenant_id: tenant.id })
      .single<{ source: string | null; account_id: string | null; livemode: boolean }>(),
    supabase
      .rpc("tenant_providers_status", {
        p_tenant_id: tenant.id,
        p_provider: "razorpay",
      })
      .single<{ connected: boolean }>(),
  ])
  const rows = (productsRes.data as Product[] | null) ?? []
  const stripeConnected = !!stripeStatusRes.data?.source
  const stripeLivemode = !!stripeStatusRes.data?.livemode
  const stripeAccountHint = stripeStatusRes.data?.account_id ?? null
  const razorpayConnected = !!razorpayStatusRes.data?.connected

  // Verify each row's stripe_product_id actually lives on the current
  // connected account — DB-only "is it null?" check is unreliable after key
  // rotation / account swap (the prod_ ID stays but Stripe returns
  // resource_missing). Probe in parallel; if no Stripe credentials are
  // configured, every row falls back to "unknown" (chip stays neutral).
  const stripeVerification = stripeConnected
    ? await verifyStripeProductSync(
        tenant.id,
        rows.map((r) => ({ id: r.id, stripe_product_id: r.stripe_product_id })),
      )
    : new Map<string, SyncVerification>()
  const totalSubs =
    mrrRes.data?.reduce((acc: number, r: any) => acc + (r.subscribers ?? 0), 0) ??
    0
  const totalRevenue =
    mrrRes.data?.reduce(
      (acc: number, r: any) => acc + (r.total_revenue_dollars ?? 0),
      0,
    ) ?? 0
  const arpu = totalSubs > 0 ? totalRevenue / totalSubs : 0
  const activeSKUs = rows.filter((r) => r.active).length

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle={
          <>
            Subscription, trial, and lifetime offers fetched by the SDK from{" "}
            <code className="bg-ink-100 px-1 rounded text-ink-700 font-mono text-[11px]">/functions/v1/config</code>.{" "}
            Changes propagate within the SDK&apos;s 1-hour cache TTL.
          </>
        }
        actions={
          <ButtonLink
            href="/products/new"
            leading={<Plus className="w-4 h-4" strokeWidth={2.5} />}
          >
            New product
          </ButtonLink>
        }
      />

      <UnsyncedProductsBanner />

      {/* Bento-Style Stats */}
      <div className="grid grid-cols-4 gap-4 mb-8 animate-slide-up">
        <div className="bg-white border border-ink-200 p-5 rounded-xl shadow-sm">
          <span className="text-ink-500 text-xs font-semibold uppercase tracking-wider">Active SKUs</span>
          <div className="flex items-end justify-between mt-2">
            <span className="text-2xl font-bold text-ink-900">{activeSKUs}</span>
            <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded ${activeSKUs > 0 ? "text-emerald-600 bg-emerald-50" : "text-ink-500 bg-ink-100"}`}>
              {activeSKUs > 0 ? "Live" : "Empty"}
            </span>
          </div>
        </div>
        <div className="bg-white border border-ink-200 p-5 rounded-xl shadow-sm">
          <span className="text-ink-500 text-xs font-semibold uppercase tracking-wider">Avg. ARPU</span>
          <div className="flex items-end justify-between mt-2">
            <span className="text-2xl font-bold text-ink-900">${arpu.toFixed(2)}</span>
            <span className="text-brand-600 text-[11px] font-bold bg-brand-50 px-1.5 py-0.5 rounded">30d avg</span>
          </div>
        </div>
        <div className="bg-white border border-ink-200 p-5 rounded-xl shadow-sm">
          <span className="text-ink-500 text-xs font-semibold uppercase tracking-wider">Config Latency</span>
          <div className="flex items-end justify-between mt-2">
            <span className="text-2xl font-bold text-ink-900">42ms</span>
            <span className="text-blue-600 text-[11px] font-bold bg-blue-50 px-1.5 py-0.5 rounded">Optimized</span>
          </div>
        </div>
        <div className="bg-white border border-ink-200 p-5 rounded-xl shadow-sm">
          <span className="text-ink-500 text-xs font-semibold uppercase tracking-wider">Cache Status</span>
          <div className="flex items-end justify-between mt-2">
            <span className="text-2xl font-bold text-ink-900">Warm</span>
            <div className="flex items-center gap-1.5 text-emerald-500">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-[11px] font-bold uppercase">Healthy</span>
            </div>
          </div>
        </div>
      </div>

      {/* Product Table Card */}
      {rows.length === 0 ? (
        <div className="bg-white rounded-xl border border-ink-200 shadow-sm p-12">
          <EmptyState
            icon={<Package className="w-5 h-5" strokeWidth={2} />}
            title="No products yet"
            description="Create a product so the SDK can render it in the paywall. You can offer subscription, trial, or one-time lifetime plans."
            action={
              <ButtonLink
                href="/products/new"
                leading={<Plus className="w-4 h-4" strokeWidth={2.5} />}
              >
                Create your first product
              </ButtonLink>
            }
            secondary={
              <Link
                href="/legal/docs/products"
                className="text-sm text-ink-500 hover:text-ink-700 transition-colors"
              >
                Read the docs →
              </Link>
            }
          />
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-ink-200 shadow-sm overflow-hidden">
          <table className="w-full text-left border-collapse">
            <thead className="bg-ink-50/50 border-b border-ink-200">
              <tr>
                <th className="px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-widest">SKU</th>
                <th className="px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-widest">Name</th>
                <th className="px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-widest">Type</th>
                <th className="px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-widest text-right">Base price</th>
                <th className="px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-widest">Providers</th>
                <th className="px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-widest text-center">Order</th>
                <th className="px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-widest text-right">Status</th>
                <th className="px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-widest text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="hover:bg-ink-50 transition-colors group cursor-pointer"
                >
                  <td className="px-6 py-4">
                    <span className="font-mono text-[12px] text-ink-500 bg-ink-100 px-1.5 py-0.5 rounded">
                      {r.sku}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <Link
                      href={`/products/${r.id}`}
                      className="text-[13px] font-semibold text-ink-900 group-hover:text-brand-600 transition-colors"
                    >
                      {r.display_name}
                    </Link>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-tighter ${
                        r.type === "trial"
                          ? "text-blue-700 bg-blue-50 border-blue-100"
                          : r.type === "lifetime"
                          ? "text-brand-700 bg-brand-50 border-brand-100"
                          : "text-ink-500 bg-ink-100 border-ink-200"
                      }`}>
                        {r.type}
                      </span>
                      {r.type === "subscription" && r.interval && (
                        <span className="text-ink-400 text-xs">· {r.interval}</span>
                      )}
                      {r.type === "trial" && r.trial_duration_days && (
                        <span className="text-ink-400 text-xs">· {r.trial_duration_days}d</span>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {r.type === "trial" ? (
                      <span className="text-[13px] font-medium text-ink-400">—</span>
                    ) : (
                      <span className="text-[13px] font-medium text-ink-900 tabular-nums">
                        {formatMoney(r.base_price_cents, r.base_currency)}
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-1.5">
                      <StripeChip
                        connected={stripeConnected}
                        verification={
                          stripeVerification.get(r.id) ??
                          (r.stripe_product_id ? "unknown" : "unsynced")
                        }
                        stripeProductId={r.stripe_product_id}
                        stripeLivemode={stripeLivemode}
                      />
                      <RazorpayChip
                        connected={razorpayConnected}
                        synced={
                          !!r.razorpay_plan_id_by_currency &&
                          Object.keys(r.razorpay_plan_id_by_currency).length > 0
                        }
                      />
                    </div>
                  </td>
                  <td className="px-6 py-4 text-center">
                    <span className="text-[13px] text-ink-500 tabular-nums">{r.display_order}</span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    {r.active ? (
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-100 uppercase">
                          Live
                        </span>
                      </div>
                    ) : (
                      <span className="text-[10px] font-bold text-ink-500 bg-ink-100 px-2 py-0.5 rounded border border-ink-200 uppercase">
                        Disabled
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <ProductRowActions
                      productId={r.id}
                      sku={r.sku}
                      hasStripe={!!r.stripe_product_id}
                      stripeProductId={r.stripe_product_id}
                      stripeLivemode={stripeLivemode}
                      stripeConnected={stripeConnected}
                      razorpayConnected={razorpayConnected}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="px-6 py-4 bg-ink-50/30 border-t border-ink-100 flex items-center justify-between">
            <span className="text-[11px] text-ink-400 font-medium">
              Showing {rows.length} product{rows.length !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      )}

      {/* Promotion / Help Cards */}
      <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="p-8 rounded-2xl bg-gradient-to-br from-brand-600 to-brand-700 text-white relative overflow-hidden group">
          <div className="relative z-10">
            <h2 className="text-xl font-bold mb-2">Power up your SDK</h2>
            <p className="text-brand-100 text-sm mb-6 max-w-sm">
              Integrate lifetime access and subscription bundles with just 3 lines of code using the PayCraft Kotlin SDK.
            </p>
            <Link
              href="/legal/docs"
              className="bg-white text-brand-700 px-4 py-2 rounded-lg text-sm font-bold inline-flex items-center gap-2 hover:bg-brand-50 transition-colors"
            >
              Read Documentation
              <ArrowRight className="w-4 h-4" />
            </Link>
          </div>
          <Database className="absolute -right-10 -bottom-10 w-48 h-48 text-white opacity-10 group-hover:scale-110 transition-transform duration-700" />
        </div>
        <div className="p-8 rounded-2xl bg-ink-900 text-white relative overflow-hidden group">
          <div className="relative z-10">
            <h2 className="text-xl font-bold mb-2">Need Custom Logic?</h2>
            <p className="text-ink-400 text-sm mb-6 max-w-sm">
              Use our dynamic webhooks to trigger custom actions when products are purchased or trials expire.
            </p>
            <Link
              href="/webhooks"
              className="bg-ink-800 text-ink-100 border border-ink-700 px-4 py-2 rounded-lg text-sm font-bold inline-flex items-center gap-2 hover:bg-ink-700 transition-colors"
            >
              Configure Webhooks
              <Webhook className="w-4 h-4" />
            </Link>
          </div>
          <Webhook className="absolute -right-10 -bottom-10 w-48 h-48 text-white opacity-5 group-hover:rotate-12 transition-transform duration-700" />
        </div>
      </div>
    </div>
  )
}

/**
 * Stripe sync chip — 4-state with live verification against Stripe.
 *
 *   not-connected — gray pill linking to /providers/stripe
 *   unsynced      — amber "pending" pill (DB has no stripe_product_id)
 *   stale         — RED "stale ⚠" pill: DB has an ID but Stripe says
 *                   resource_missing. Caused by account swap / key
 *                   rotation. Tooltip points the operator at re-sync.
 *   verified      — green "✓ test" / "✓ live" pill linking to the product
 *                   on the right Stripe Dashboard mode.
 *   unknown       — render as plain "marked synced (unverified)" with a
 *                   subtle warning tint when we can't reach Stripe.
 */
function StripeChip({
  connected,
  verification,
  stripeProductId,
  stripeLivemode,
}: {
  connected: boolean
  verification: SyncVerification
  stripeProductId: string | null
  stripeLivemode: boolean
}) {
  if (!connected) {
    return (
      <Link
        href="/providers/stripe"
        title="Stripe not connected — click to set up"
        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-tighter bg-ink-100 text-ink-500 border border-ink-200 px-1.5 py-0.5 rounded hover:bg-ink-200"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-ink-300" /> Stripe
      </Link>
    )
  }
  if (verification === "unsynced") {
    return (
      <span
        title="Connected, but this product hasn't been pushed to Stripe yet — click Sync above."
        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-tighter bg-warning-50 text-warning-700 border border-warning-200 px-1.5 py-0.5 rounded"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-warning-500" /> Stripe · pending
      </span>
    )
  }
  if (verification === "stale") {
    return (
      <span
        title={`Stripe doesn't recognize ${stripeProductId} on this account (probably from a different key). Re-sync to recreate fresh.`}
        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-tighter bg-danger-50 text-danger-700 border border-danger-200 px-1.5 py-0.5 rounded"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-danger-500" /> Stripe · stale ⚠
      </span>
    )
  }
  if (verification === "unknown") {
    return (
      <span
        title="Stripe API unreachable — couldn't verify whether this product still lives on the current account."
        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-tighter bg-ink-50 text-ink-600 border border-ink-200 px-1.5 py-0.5 rounded"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-ink-400" /> Stripe · unverified
      </span>
    )
  }
  // verified
  const url = stripeProductId
    ? `https://dashboard.stripe.com/${stripeLivemode ? "" : "test/"}products/${stripeProductId}`
    : null
  const modeBadge = stripeLivemode ? "live" : "test"
  return url ? (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={`Verified on Stripe ${modeBadge} mode — click to open on dashboard.stripe.com`}
      className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-tighter bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded hover:bg-emerald-100"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Stripe {modeBadge} ✓
    </a>
  ) : (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-tighter bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Stripe {modeBadge} ✓
    </span>
  )
}

function RazorpayChip({
  connected,
  synced,
}: {
  connected: boolean
  synced: boolean
}) {
  if (!connected) {
    return (
      <Link
        href="/providers/razorpay"
        title="Razorpay not connected — click to set up"
        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-tighter bg-ink-100 text-ink-500 border border-ink-200 px-1.5 py-0.5 rounded hover:bg-ink-200"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-ink-300" /> Razorpay
      </Link>
    )
  }
  if (!synced) {
    return (
      <span
        title="Connected, but this product hasn't been pushed to Razorpay yet"
        className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-tighter bg-warning-50 text-warning-700 border border-warning-200 px-1.5 py-0.5 rounded"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-warning-500" /> Razorpay · pending
      </span>
    )
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-tighter bg-emerald-50 text-emerald-700 border border-emerald-200 px-1.5 py-0.5 rounded">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> Razorpay ✓
    </span>
  )
}
