import { listResource } from "@/lib/api-v1-helpers"
export const dynamic = "force-dynamic"

/**
 * GET /v1/products — the catalogue, with each provider's synced artifact ids.
 *
 * The provider id columns are the useful part for automation: they answer "did this product
 * actually land at Stripe / Play / the App Store?" without a second call per provider.
 */
export async function GET(req: Request) {
  return listResource(req, "products:read", {
    table: "tenant_products",
    columns:
      "id, sku, display_name, type, interval, base_price_cents, base_currency, active, " +
      "trial_enabled, trial_duration_days, stripe_product_id, stripe_price_id_by_currency, " +
      "razorpay_plan_id_by_currency, razorpay_plan_id_by_currency_test, live_plan_ids_verified, " +
      "play_product_id, app_store_product_id, sync_state, created_at, updated_at",
    orderBy: { column: "created_at", ascending: false },
    filters: (q) => ({ sku: q.get("sku"), type: q.get("type") }),
  })
}
