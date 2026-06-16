import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { CouponsManager } from "@/components/coupons/coupons-manager"

export default async function CouponsPage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const [{ data: coupons }, { data: products }] = await Promise.all([
    supabase.rpc("tenant_coupons_list", { p_tenant_id: tenant.id }),
    supabase
      .from("tenant_products")
      .select("id, sku, display_name, interval")
      .eq("tenant_id", tenant.id)
      .eq("active", true)
      .order("display_order"),
  ])

  return (
    <CouponsManager
      initialCoupons={(coupons ?? []) as any[]}
      products={(products ?? []) as any[]}
    />
  )
}
