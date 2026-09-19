export const runtime = "edge"

import Link from "next/link"
import { ArrowLeft, Pencil, Globe } from "lucide-react"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { ProductSyncPanel } from "@/components/products/product-sync-panel"
import { ProviderDetailsSection } from "@/components/products/provider-details-section"
import { PROVIDER_CONNECTED_COLUMNS, isProviderConnected } from "@/lib/provider-connected"
import { verifyStripeProductSync } from "@/lib/stripe-sync-verify"

/**
 * Read-only product detail page. The default landing for an existing
 * product — shows current configuration + provider sync state without
 * touching form fields. Editing is one click away at /products/{id}/edit.
 */
export default async function ProductViewPage({
  params,
}: {
  params: { id: string }
}) {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const { data: product } = await supabase
    .from("tenant_products")
    .select("*")
    .eq("id", params.id)
    .eq("tenant_id", tenant.id)
    .single()
  if (!product) notFound()

  const { data: pricingRows = [] } = await supabase
    .from("tenant_pricing")
    .select("currency, amount_cents, locale")
    .eq("tenant_id", tenant.id)
    .eq("product_id", params.id)
    .order("currency")

  /**
   * `tenant_pricing` is per-LOCALE, not per-currency: DE, FR, ES and IT all price in EUR. Rendering
   * the rows directly therefore printed EUR four times — and, keyed by currency, produced duplicate
   * React keys. Collapse to one row per currency, keeping the DISTINCT amounts: if two locales that
   * share a currency disagree on price, that is a real inconsistency and hiding it behind "the first
   * one" would be worse than the duplication.
   */
  const byCurrency = new Map<string, { amounts: Set<number>; locales: number }>()
  for (const r of (pricingRows ?? []) as any[]) {
    const e = byCurrency.get(r.currency) ?? { amounts: new Set<number>(), locales: 0 }
    e.amounts.add(r.amount_cents)
    e.locales += 1
    byCurrency.set(r.currency, e)
  }
  const currencyRows = [...byCurrency.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, e]) => ({ currency, amounts: [...e.amounts].sort((x, y) => x - y), locales: e.locales }))

  const p: any = product

  // Provider rows for THIS tenant: connection state + the payment links the provider issued for
  // this product's sku. `live_payment_links` is {sku: {currency: url}} — a per-product slice of a
  // per-provider column, which is why it has to be read here rather than off the product row.
  const { data: providerRows = [] } = await supabase
    .from("tenant_providers")
    .select(`${PROVIDER_CONNECTED_COLUMNS}, live_payment_links, test_payment_links`)
    .eq("tenant_id", tenant.id)

  const providerConnected: Record<string, boolean> = {}
  const providerActive: Record<string, boolean> = {}
  const providerLinks: Record<string, { mode: "live" | "test"; links: Record<string, string> }> = {}
  for (const row of (providerRows ?? []) as any[]) {
    // Last row wins per provider only when it is the stronger claim: a tenant can hold more than one
    // row for a provider (re-onboarding leaves the earlier one behind), and an empty leftover must
    // not overwrite a connected row's state.
    providerConnected[row.provider] = providerConnected[row.provider] || isProviderConnected(row)
    providerActive[row.provider] = providerActive[row.provider] || !!row.is_active
    const live = (row.live_payment_links ?? {})[p.sku] ?? {}
    const test = (row.test_payment_links ?? {})[p.sku] ?? {}
    const chosen = Object.keys(live).length ? { mode: "live" as const, links: live } : { mode: "test" as const, links: test }
    if (Object.keys(chosen.links).length) providerLinks[row.provider] = chosen
  }

  // Live verify against the current Stripe account so the sync panel chip
  // doesn't lie when a stale ID is in the DB.
  const verifyMap = await verifyStripeProductSync(tenant.id, [
    { id: params.id, stripe_product_id: p.stripe_product_id ?? null },
  ])
  const stripeVerification = verifyMap.get(params.id) ?? "unknown"

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link
            href="/products"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-500 hover:text-ink-700 mb-3"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Back to products
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-ink-900">{p.display_name}</h1>
            <span className="font-mono text-xs bg-ink-100 text-ink-600 px-2 py-0.5 rounded">
              {p.sku}
            </span>
            {p.active ? (
              <span className="text-[10px] font-bold uppercase tracking-tighter bg-emerald-50 text-emerald-700 border border-emerald-100 px-2 py-0.5 rounded">
                Live
              </span>
            ) : (
              <span className="text-[10px] font-bold uppercase tracking-tighter bg-ink-100 text-ink-500 border border-ink-200 px-2 py-0.5 rounded">
                Disabled
              </span>
            )}
          </div>
          <p className="text-sm text-ink-500 mt-1">
            Read-only view. Changes propagate to the SDK on the next config
            fetch (cached up to 5 min client-side).
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <Link
            href={`/products/${params.id}/pricing`}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-white text-ink-900 border border-ink-200 rounded-lg hover:bg-ink-50"
          >
            <Globe className="w-3.5 h-3.5" />
            Locale pricing
          </Link>
          <Link
            href={`/products/${params.id}/edit`}
            className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-bold bg-ink-900 text-white rounded-lg hover:bg-ink-800"
          >
            <Pencil className="w-3.5 h-3.5" />
            Edit product
          </Link>
        </div>
      </div>

      {/* Provider sync — first because it's the most-actioned panel after a save */}
      <ProductSyncPanel
        productId={params.id}
        initialStripeProductId={p.stripe_product_id ?? null}
        initialRazorpayPlanIds={p.razorpay_plan_id_by_currency ?? null}
        initialPlayProductId={p.play_product_id ?? null}
        initialAppStoreProductId={p.app_store_product_id ?? null}
        stripeVerification={stripeVerification}
      />

      {/* Everything each provider holds for THIS product — ids, links, last verdict. Read-only;
          the panel above is the write path. */}
      <ProviderDetailsSection
        product={p as any}
        connected={providerConnected}
        active={providerActive}
        paymentLinks={providerLinks}
      />

      {/* Configuration snapshot */}
      <div className="bg-white border border-ink-200 rounded-xl p-6">
        <h3 className="text-sm font-bold text-ink-900 mb-4">Configuration</h3>
        <div className="grid grid-cols-2 gap-x-8 gap-y-4">
          <Field label="Type">
            <span className="capitalize">{p.type}</span>
            {p.interval ? (
              <span className="text-ink-400"> · {p.interval}</span>
            ) : null}
          </Field>
          <Field label="Display order">{p.display_order ?? 0}</Field>
          <Field label="Base price">
            {p.type === "trial" ? (
              <span className="text-ink-400">—</span>
            ) : (
              <>
                {formatMoney(p.base_price_cents, p.base_currency)}{" "}
                <span className="text-ink-400">{p.base_currency}</span>
              </>
            )}
          </Field>
          <Field label="Free trial">
            {p.trial_enabled ? (
              <>
                <span className="text-emerald-700 font-semibold">Yes</span>
                {p.trial_duration_days ? (
                  <span className="text-ink-500"> · {p.trial_duration_days} days</span>
                ) : null}
              </>
            ) : (
              <span className="text-ink-500">No</span>
            )}
          </Field>
          <Field label="Discount">
            {p.discount_percent ? (
              <>
                <span className="text-brand-700 font-semibold">{p.discount_percent}% off</span>
                {p.discount_ends_at ? (
                  <span className="text-ink-500">
                    {" "}
                    · ends {new Date(p.discount_ends_at).toLocaleDateString()}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-ink-500">None</span>
            )}
          </Field>
          <Field label="Pricing mode">
            <span className="capitalize">{p.pricing_mode ?? "auto"}</span>
          </Field>
        </div>
      </div>

      {/* Per-currency pricing matrix */}
      {currencyRows.length > 0 && (
        <div className="bg-white border border-ink-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-ink-900">Pricing matrix</h3>
            <span className="text-[11px] text-ink-500">
              {currencyRows.length} currenc{currencyRows.length === 1 ? "y" : "ies"} ·{" "}
              {pricingRows?.length ?? 0} locale{(pricingRows?.length ?? 0) === 1 ? "" : "s"}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {currencyRows.map((row) => (
              <div
                key={row.currency}
                className="flex items-center justify-between p-2 bg-ink-50 rounded border border-ink-100"
                title={`${row.locales} locale${row.locales === 1 ? "" : "s"}`}
              >
                <span className="text-[11px] font-mono font-bold text-ink-700">
                  {row.currency}
                </span>
                <span
                  className={`text-xs tabular-nums ${row.amounts.length > 1 ? "text-amber-700 font-semibold" : "text-ink-900"}`}
                >
                  {row.amounts.map((a) => formatMoney(a, row.currency)).join(" / ")}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-ink-400 mb-1">
        {label}
      </div>
      <div className="text-sm text-ink-900">{children}</div>
    </div>
  )
}

function formatMoney(cents: number | null | undefined, currency: string): string {
  if (cents == null) return "—"
  if (currency === "INR") return `₹${(cents / 100).toFixed(0)}`
  const symbol =
    currency === "USD"
      ? "$"
      : currency === "EUR"
        ? "€"
        : currency === "GBP"
          ? "£"
          : ""
  return symbol ? `${symbol}${(cents / 100).toFixed(2)}` : `${(cents / 100).toFixed(2)}`
}