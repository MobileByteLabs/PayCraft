import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { ProductForm } from "@/components/products/product-form"

/**
 * Edit form for an existing product. Lives at /products/[id]/edit so the
 * read-only `/products/[id]` view stays the default landing — operators
 * who only want to verify state / re-sync don't have to scroll past form
 * fields they're not changing.
 */
export default async function ProductEditPage({
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

  const { data: subscriptions } = await supabase
    .from("tenant_products")
    .select("id, sku, display_name, base_price_cents, base_currency, interval")
    .eq("tenant_id", tenant.id)
    .eq("type", "subscription")
    .eq("active", true)

  return (
    <div className="space-y-6">
      <div>
        <Link
          href={`/products/${params.id}`}
          className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-500 hover:text-ink-700 mb-3"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to product
        </Link>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">Edit product</h1>
        <p className="text-sm text-gray-500">
          Changes propagate to the SDK on the next config fetch (max 1h cached
          client-side). After saving you'll be returned to the read-only view
          where you can re-sync providers if pricing changed.
        </p>
      </div>
      <ProductForm initial={product as any} subscriptions={subscriptions ?? []} />
    </div>
  )
}
