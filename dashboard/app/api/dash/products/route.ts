export const runtime = "edge"

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { verifyStripeProductSync } from "@/lib/stripe-sync-verify"

/**
 * Stripe verdict per product (`verified | stale | unsynced | unknown`) for the products list and the
 * product view. Server-side because it calls Stripe with the tenant's connected credentials; the
 * pages read everything else from Supabase in the browser. `?id=` narrows it to one product.
 */
export async function GET(req: NextRequest) {
  const { tenant } = await requireTenant()
  const id = req.nextUrl.searchParams.get("id")
  let query = createClient()
    .from("tenant_products")
    .select("id, stripe_product_id")
    .eq("tenant_id", tenant.id)
  if (id) query = query.eq("id", id)
  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const verification = await verifyStripeProductSync(tenant.id, data ?? [])
  return NextResponse.json({ verification: Object.fromEntries(verification) })
}
