import Link from "next/link"
import { Package, Plus, Zap, DollarSign, Clock, Database, ArrowRight, Webhook } from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { PageHeader } from "@/components/ui/page-header"
import { ButtonLink } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/empty-state"

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
  const [productsRes, mrrRes] = await Promise.all([
    supabase.rpc("tenant_products_list", { p_tenant_id: tenant.id }),
    supabase
      .from("tenant_revenue_by_plan_view")
      .select("subscribers,total_revenue_dollars")
      .eq("tenant_id", tenant.id),
  ])
  const rows = (productsRes.data as Product[] | null) ?? []
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
                <th className="px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-widest text-center">Order</th>
                <th className="px-6 py-4 text-[11px] font-bold text-ink-400 uppercase tracking-widest text-right">Status</th>
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
