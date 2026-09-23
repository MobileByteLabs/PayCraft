import { NextResponse } from "next/server"
import { withApiKey } from "@/lib/api-v1-helpers"
import { loadProductSyncBody, runProductSync } from "@/lib/stripe-route-helper"
import { newRunId } from "@/lib/request-log"
export const dynamic = "force-dynamic"

/**
 * POST /v1/products/{id}/sync — push ONE product to its providers.
 *
 * The scoped counterpart to POST /v1/sync. No confirm_count here: that gate exists because the
 * bulk drain acts on a set the caller has not enumerated, whereas this names its single subject in
 * the URL. Optional `?provider=` narrows it further.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  return withApiKey(req, "products:sync", async (ctx) => {
    const { data: owned } = await ctx.admin
      .from("tenant_products")
      .select("id")
      .eq("tenant_id", ctx.tenantId)
      .eq("id", params.id)
      .maybeSingle()
    if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 })

    const provider = new URL(req.url).searchParams.get("provider") ?? undefined
    const loaded = await loadProductSyncBody(ctx.admin as never, ctx.tenantId, params.id)
    if (!loaded) return NextResponse.json({ error: "not_found" }, { status: 404 })

    const summary = await runProductSync(ctx.admin as never, {
      tenantId: ctx.tenantId,
      productId: params.id,
      body: loaded.body,
      productName: loaded.product.display_name,
      runId: newRunId(),
      onlyProvider: provider as never,
      existingStripeProductId: loaded.product.stripe_product_id ?? undefined,
      existingPrices: loaded.product.stripe_price_id_by_currency ?? undefined,
      existingRazorpayPlanIds: loaded.product.razorpay_plan_id_by_currency ?? undefined,
      existingRazorpayPlanIdsTest: loaded.product.razorpay_plan_id_by_currency_test ?? undefined,
      existingPlayProductId: loaded.product.play_product_id ?? undefined,
      existingAppStoreProductId: loaded.product.app_store_product_id ?? undefined,
    })

    // 200 with per-provider verdicts, not a bare ok. A provider can fail while the call succeeds,
    // and collapsing that into a status code is how "synced: 3" came to mean three skips.
    return NextResponse.json(summary)
  })
}
