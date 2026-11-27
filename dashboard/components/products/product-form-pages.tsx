"use client"

import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { ArrowLeft } from "lucide-react"
import { useDashboard } from "@/components/app-providers"
import { ProductForm } from "@/components/products/product-form"
import { NewProductPicker } from "@/components/products/new-product-picker"

/** Active subscriptions — what a trial / add-on can attach to. Shared by the new and edit forms. */
function useActiveSubscriptions() {
  const { tenantId, supabase } = useDashboard()
  return useQuery({
    queryKey: ["products", tenantId, "subscriptions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_products")
        .select("id, sku, display_name, base_price_cents, base_currency, interval")
        .eq("tenant_id", tenantId)
        .eq("type", "subscription")
        .eq("active", true)
      if (error) throw new Error(error.message)
      return data ?? []
    },
  })
}

const BLANK = {
  sku: "",
  type: "subscription" as const,
  display_name: "",
  interval: "month" as const,
  trial_enabled: true,
  trial_duration_days: 7,
  attaches_to_product_id: null,
  base_price_cents: 999,
  base_currency: "USD",
  pricing_mode: "auto" as const,
  global_price_cents: null,
  global_currency: null,
  display_order: 0,
  active: true,
}

/**
 * /products/new — the form is usable at once; the "attach to subscription" list fills in when the
 * read lands (it is only needed for trials).
 */
export function NewProduct({ mode }: { mode?: string }) {
  const subscriptions = useActiveSubscriptions()
  return (
    <NewProductPicker
      initial={BLANK}
      subscriptions={subscriptions.data ?? []}
      defaultMode={mode === "manual" ? "manual" : "quick"}
    />
  )
}

/**
 * Edit form for an existing product. Lives at /products/[id]/edit so the
 * read-only `/products/[id]` view stays the default landing — operators
 * who only want to verify state / re-sync don't have to scroll past form
 * fields they're not changing.
 */
export function ProductEdit({ productId }: { productId: string }) {
  const { tenantId, supabase } = useDashboard()
  const product = useQuery({
    queryKey: ["products", tenantId, "edit", productId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tenant_products")
        .select("*")
        .eq("id", productId)
        .eq("tenant_id", tenantId)
        .maybeSingle()
      if (error) throw new Error(error.message)
      return data
    },
    // The form copies `initial` into local state once — a background refetch must not reset edits.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  })
  const subscriptions = useActiveSubscriptions()

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/products/${productId}`}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-500 hover:text-ink-700 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to product
        </Link>
        <h1 className="text-2xl font-bold text-ink-900 mb-1">Edit product</h1>
        <p className="text-sm text-ink-500">
          Changes propagate to the SDK on the next config fetch (cached up to 5 min
          client-side). After saving you'll be returned to the read-only view
          where you can re-sync providers if pricing changed.
        </p>
      </div>
      {product.isPending ? (
        <div role="status" aria-busy="true" className="max-w-xl space-y-5 animate-pulse">
          <span className="sr-only">Loading product…</span>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2">
              <div className="h-3 w-32 rounded bg-ink-200/70" />
              <div className="h-9 rounded bg-ink-100" />
            </div>
          ))}
        </div>
      ) : product.isError ? (
        <div role="alert" className="max-w-xl rounded-lg bg-danger-50 border border-danger-200 px-4 py-3 text-sm text-danger-700">
          Couldn&rsquo;t load this product: {product.error.message}{" "}
          <button onClick={() => product.refetch()} className="font-semibold underline">
            Retry
          </button>
        </div>
      ) : !product.data ? (
        <div className="max-w-xl text-sm text-ink-600">
          This product doesn&rsquo;t exist in this app.{" "}
          <Link href="/products" className="font-semibold underline">
            Back to products
          </Link>
        </div>
      ) : (
        <ProductForm initial={product.data as any} subscriptions={subscriptions.data ?? []} />
      )}
    </div>
  )
}
