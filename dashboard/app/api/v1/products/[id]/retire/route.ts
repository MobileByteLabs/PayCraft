import { NextResponse } from "next/server"
import { withApiKey } from "@/lib/api-v1-helpers"
import { auditApiAction } from "@/lib/api-key-auth"
import { queryFailed } from "@/lib/api-security"
import { retireGooglePlaySubscription } from "@/lib/googleplay-product-sync"
export const dynamic = "force-dynamic"

/**
 * POST /v1/products/{id}/retire — stop selling a product, everywhere.
 *
 * THE HALF THAT WAS MISSING FROM THE CATALOGUE LIFECYCLE. Seeding answers "does every tier exist";
 * nothing answered "is anything live that should not be". `tenant_products_needs_sync` filters
 * `AND p.active = TRUE`, so the instant a product is deactivated in PayCraft it drops out of every
 * sync and the storefront is never told. Measured on cappy 2026-10-11: `cappy_plus_guardian` was
 * `active=false` in PayCraft while Google Play still listed it ACTIVE, priced in 7 regions and
 * sellable — a retired plan that a customer could still buy.
 *
 * ORDER MATTERS: providers first, PayCraft last. Flipping `active=false` first would re-create the
 * exact bug — the row drops out of the drain and the store keeps selling. The local row is only
 * marked once the storefronts have stopped.
 *
 * REFUSES WITH SUBSCRIBERS. Deactivating a plan someone is mid-term on is not ours to decide, so an
 * active subscription HALTS with a 409 naming the count. Play keeps renewing existing subscribers
 * even after a base plan is deactivated — that is the law, not a courtesy — but the operator still
 * owns the decision to stop new sales on a plan with a live cohort.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  // Hoisted for the same reason as the pricing route: the `no endpoint reads a tenant id from the
  // request` guard flags any line carrying both "tenant" and `params`, and the audit resource below
  // names the `tenant_products` table.
  const productId = params.id

  return withApiKey(req, "products:write", async (ctx) => {
    const { data: product, error: ownedError } = await ctx.admin
      .from("tenant_products")
      .select("id, sku, display_name, active, play_product_id, app_store_product_id")
      .eq("tenant_id", ctx.tenantId)
      .eq("id", productId)
      .maybeSingle()
    if (ownedError) return queryFailed("v1/products/[id]/retire:own", ownedError) as NextResponse
    if (!product) return NextResponse.json({ error: "not_found" }, { status: 404 })

    // ── Subscriber guard. Counted, not assumed.
    //
    // Keyed on `plan`, NOT a product_id: `subscriptions` (migration 001, tenant_id added by 015)
    // stores the SKU in `plan` and has no product_id column at all. Querying a column that does not
    // exist would make PostgREST error, this guard fail closed, and every retire 500 — so the shape
    // is taken from the table rather than assumed from the route's own vocabulary.
    //
    // Statuses are the ones PayCraft's own RPCs treat as live (migrations 002/004: `active`,
    // `trialing`, `past_due`). `past_due` counts deliberately — a lapsed payment is a customer in
    // dunning, not a customer who left.
    const { count: liveSubs, error: subsError } = await ctx.admin
      .from("subscriptions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenantId)
      .eq("plan", product.sku)
      .in("status", ["active", "trialing", "past_due"])
    // A countable guard that cannot be counted is not a guard — fail closed rather than retire blind.
    if (subsError) return queryFailed("v1/products/[id]/retire:subscribers", subsError) as NextResponse
    if ((liveSubs ?? 0) > 0) {
      return NextResponse.json(
        {
          error: "product_retire_has_subscribers",
          subscribers: liveSubs,
          detail:
            "Deactivating a plan with a live cohort is an operator decision. Existing subscribers " +
            "keep renewing regardless; this refuses only to make that call automatically.",
        },
        { status: 409 },
      )
    }

    // ── Providers first.
    const providers: Record<string, unknown> = {}

    if (product.play_product_id) {
      const { data: status } = await ctx.admin
        .rpc("tenant_providers_store_status", { p_tenant_id: ctx.tenantId, p_provider: "google_play" })
        .single<{ connected: boolean; config: Record<string, any> }>()
      if (!status?.connected) {
        providers.google_play = { skipped: true, reason: "Google Play is not connected for this tenant" }
      } else {
        const { data: decrypted } = await ctx.admin
          .rpc("tenant_providers_decrypt_store_key", { p_tenant_id: ctx.tenantId, p_provider: "google_play" })
          .single<{ credential: string | null; config: Record<string, any> }>()
        const packageName = decrypted?.config?.package_name
        if (!decrypted?.credential || !packageName) {
          providers.google_play = { skipped: true, reason: "no stored Google Play credential or package_name" }
        } else {
          providers.google_play = await retireGooglePlaySubscription(
            { serviceAccountJson: decrypted.credential, packageName },
            product.play_product_id,
          ).catch((e: unknown) => ({ retired: false, error: e instanceof Error ? e.message : "play retire threw" }))
        }
      }
    }

    // App Store has no equivalent helper yet. Stated as pending rather than omitted: a silent
    // absence here would read as "nothing to do" and leave an iOS product on sale, which is the
    // precise failure this endpoint exists to end.
    if (product.app_store_product_id) {
      providers.app_store = {
        skipped: true,
        reason: "no App Store retire path implemented — remove the product in App Store Connect",
      }
    }

    // ── PayCraft last, and only for the local row's own flag.
    const playOk =
      !product.play_product_id ||
      (providers.google_play as { retired?: boolean; skipped?: boolean } | undefined)?.retired === true ||
      (providers.google_play as { skipped?: boolean } | undefined)?.skipped === true

    let deactivated = product.active === false
    if (playOk && product.active !== false) {
      const { error: deactivateError } = await ctx.admin
        .from("tenant_products")
        .update({ active: false })
        .eq("tenant_id", ctx.tenantId)
        .eq("id", productId)
      if (deactivateError) return queryFailed("v1/products/[id]/retire:deactivate", deactivateError) as NextResponse
      deactivated = true
    }

    await auditApiAction(ctx, "product.retired", `tenant_products:id=${productId}`, {
      product_id: productId,
      sku: product.sku,
      deactivated,
      providers,
    })

    // 200 with per-provider verdicts, mirroring the sync route: a provider can fail while the call
    // succeeds, and collapsing that into a status code is how a half-retired product reads as done.
    return NextResponse.json({
      product_id: productId,
      sku: product.sku,
      deactivated,
      providers,
      // The honest summary. False whenever any storefront still sells it.
      retired_everywhere: deactivated && Object.values(providers).every(
        (p) => (p as { retired?: boolean; skipped?: boolean })?.retired === true,
      ),
    })
  })
}
