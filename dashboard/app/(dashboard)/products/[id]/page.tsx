import { notFound } from "next/navigation"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { ProductForm } from "@/components/products/product-form"

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
    <div>
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Edit product</h1>
      <p className="text-sm text-gray-500 mb-6">
        Changes propagate to the SDK on the next config fetch (max 1h cached
        client-side).
      </p>
      <ProductForm initial={product as any} subscriptions={subscriptions ?? []} />
    </div>
  )
}
