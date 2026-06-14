import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { ProductFormShell } from "@/components/products/product-form-shell"

export default async function NewProductPage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const { data: subscriptions } = await supabase
    .from("tenant_products")
    .select("id, sku, display_name, base_price_cents, base_currency, interval")
    .eq("tenant_id", tenant.id)
    .eq("type", "subscription")
    .eq("active", true)

  const blank = {
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

  return <ProductFormShell initial={blank} subscriptions={subscriptions ?? []} />
}
