import Link from "next/link"
import { Package, Plus, Zap, DollarSign, Clock, Database } from "lucide-react"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { PageHeader } from "@/components/ui/page-header"
import { ButtonLink } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { DataTable } from "@/components/ui/data-table"
import { EmptyState } from "@/components/ui/empty-state"
import { StatCard } from "@/components/ui/card"

type Product = {
  id: string
  sku: string
  type: "subscription" | "trial" | "lifetime"
  display_name: string
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

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle={
          <>
            Subscription, trial, and lifetime offers fetched by the SDK from{" "}
            <code className="code-inline">/functions/v1/config</code>. Changes
            propagate within the SDK's 1-hour cache TTL.
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

      {/* Bento stats */}
      <section className="grid grid-cols-4 gap-4 mb-6 animate-slide-up">
        <StatCard
          label="Active SKUs"
          value={rows.filter((r) => r.active).length}
          icon={<Database className="w-4 h-4" />}
          trend={
            rows.length > 0
              ? { value: "Live", tone: "success" }
              : { value: "Empty", tone: "neutral" }
          }
        />
        <StatCard
          label="Avg. ARPU"
          value={`$${arpu.toFixed(2)}`}
          icon={<DollarSign className="w-4 h-4" />}
          trend={{ value: "30d avg", tone: "brand" }}
        />
        <StatCard
          label="Config latency"
          value="42ms"
          icon={<Zap className="w-4 h-4" />}
          trend={{ value: "p95 healthy", tone: "info" }}
        />
        <StatCard
          label="Cache status"
          value="Warm"
          icon={<Clock className="w-4 h-4" />}
          trend={{ value: "1h TTL", tone: "success" }}
        />
      </section>

      <DataTable<Product>
        columns={[
          {
            key: "sku",
            header: "SKU",
            cell: (r) => <span className="code-inline">{r.sku}</span>,
          },
          {
            key: "name",
            header: "Name",
            cell: (r) => (
              <Link
                href={`/products/${r.id}`}
                className="text-sm font-semibold text-ink-900 group-hover:text-brand-600 transition-colors"
              >
                {r.display_name}
              </Link>
            ),
          },
          {
            key: "type",
            header: "Type",
            cell: (r) => (
              <div className="flex items-center gap-2">
                <Badge
                  tone={
                    r.type === "trial"
                      ? "info"
                      : r.type === "lifetime"
                      ? "brand"
                      : "neutral"
                  }
                >
                  {r.type}
                </Badge>
                {r.type === "subscription" && r.interval && (
                  <span className="text-xs text-ink-400">· {r.interval}</span>
                )}
                {r.type === "trial" && r.trial_duration_days && (
                  <span className="text-xs text-ink-400">
                    · {r.trial_duration_days}d
                  </span>
                )}
              </div>
            ),
          },
          {
            key: "price",
            header: "Base price",
            align: "right",
            cell: (r) =>
              r.type === "trial" ? (
                <span className="text-ink-300">—</span>
              ) : (
                <span className="text-sm font-medium text-ink-900 tabular-nums">
                  {formatMoney(r.base_price_cents, r.base_currency)}
                </span>
              ),
          },
          {
            key: "order",
            header: "Order",
            align: "center",
            width: "80px",
            cell: (r) => (
              <span className="text-sm text-ink-500 tabular-nums">
                {r.display_order}
              </span>
            ),
          },
          {
            key: "status",
            header: "Status",
            align: "right",
            width: "120px",
            cell: (r) =>
              r.active ? (
                <span className="inline-flex items-center justify-end gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-success-500 animate-pulse-soft" />
                  <Badge tone="success">Live</Badge>
                </span>
              ) : (
                <Badge tone="neutral">Disabled</Badge>
              ),
          },
        ]}
        rows={rows}
        rowKey={(r) => r.id}
        rowHref={(r) => `/products/${r.id}`}
        empty={
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
        }
      />
    </div>
  )
}
