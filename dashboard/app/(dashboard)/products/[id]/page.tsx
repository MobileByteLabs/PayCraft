import Link from "next/link"
import { ArrowLeft, Pencil, Tag, Globe } from "lucide-react"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { ProductSyncPanel } from "@/components/products/product-sync-panel"
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
    .select("currency, amount_cents")
    .eq("tenant_id", tenant.id)
    .eq("product_id", params.id)
    .order("currency")

  const p: any = product

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
            fetch (max 1h cached client-side).
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
        stripeVerification={stripeVerification}
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
      {pricingRows && pricingRows.length > 0 && (
        <div className="bg-white border border-ink-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-bold text-ink-900">Pricing matrix</h3>
            <span className="text-[11px] text-ink-500">
              {pricingRows.length} currenc{pricingRows.length === 1 ? "y" : "ies"}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-2">
            {pricingRows.map((row: any) => (
              <div
                key={row.currency}
                className="flex items-center justify-between p-2 bg-ink-50 rounded border border-ink-100"
              >
                <span className="text-[11px] font-mono font-bold text-ink-700">
                  {row.currency}
                </span>
                <span className="text-xs tabular-nums text-ink-900">
                  {formatMoney(row.amount_cents, row.currency)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Stripe price IDs (helpful for debugging webhook / SDK config flow) */}
      {p.stripe_price_id_by_currency &&
        Object.keys(p.stripe_price_id_by_currency).length > 0 && (
          <details className="bg-white border border-ink-200 rounded-xl p-6">
            <summary className="text-sm font-bold text-ink-900 cursor-pointer flex items-center gap-2">
              <Tag className="w-4 h-4 text-ink-400" />
              Stripe price IDs ({Object.keys(p.stripe_price_id_by_currency).length})
            </summary>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {Object.entries(p.stripe_price_id_by_currency).map(([ccy, id]) => (
                <div
                  key={ccy}
                  className="flex items-center justify-between p-2 bg-ink-50 rounded text-[11px] font-mono"
                >
                  <span className="font-bold text-ink-700">{ccy}</span>
                  <span className="text-ink-500 truncate ml-2">{id as string}</span>
                </div>
              ))}
            </div>
          </details>
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
