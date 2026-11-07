export const runtime = "edge"

import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { computeStoreReadiness } from "@/lib/store-readiness"

/**
 * Are the native-store products actually SELLABLE? Asked of the STORES, per store.
 *
 * This deliberately does NOT consult `app_store_product_id` / `play_product_id` beyond needing them
 * to look a product up. A local identifier records that a sync call once succeeded; it says nothing
 * about whether the store considers the product complete. Conflating the two let three App Store
 * subscriptions sit in MISSING_METADATA while every surface reported a clean sync.
 *
 * Each store is reported independently and only when connected: an Android-only tenant must not be
 * failed for an App Store it does not ship to, and vice versa.
 *
 * Returns 200 even when not ready — "the store is not ready" is a successful ANSWER, and an error
 * status would make callers treat it as a transport failure and retry.
 */

export async function GET() {
  const { tenant } = await requireTenant()
  return NextResponse.json(await computeStoreReadiness(createClient(), tenant.id))
}
