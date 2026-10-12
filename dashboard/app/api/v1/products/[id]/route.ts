import { auditApiAction } from "@/lib/api-key-auth"
import { buildProductRow, toRpcRow } from "@/lib/product-write"
import { NextResponse } from "next/server"
import { withApiKey } from "@/lib/api-v1-helpers"
import { queryFailed } from "@/lib/api-security"
export const dynamic = "force-dynamic"

/** GET /v1/products/{id} — one product, with its pricing rows. */
export async function GET(req: Request, { params }: { params: { id: string } }) {
  return withApiKey(req, "products:read", async (ctx) => {
    const { data, error } = await ctx.admin
      .from("tenant_products")
      .select("*")
      // Both predicates matter: the id alone would let a key read another tenant's product.
      .eq("tenant_id", ctx.tenantId)
      .eq("id", params.id)
      .maybeSingle()

    if (error) return queryFailed("v1/products/[id]", error) as NextResponse
    if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 })

    // `locale`, not `country_code`. 029_tenant_pricing.sql names the column `locale` (an uppercase
    // ISO 3166-1 alpha-2 country code) and no migration ever added `country_code` — so this select
    // was asking for a column that has never existed. PostgREST answers that with an error, not an
    // empty set, and the error was being DISCARDED by destructuring only `data`: the route then
    // rendered `pricing: []` for every product, unconditionally.
    //
    // That is worse than a missing feature, because the endpoint's own docstring promises "its
    // pricing rows" and the empty array reads as a fact. It was believed on 2026-10-11 while
    // diagnosing cappy's unbuyable Play products — "all four products have zero pricing rows" was
    // read straight off this response and was not evidence of anything.
    const { data: pricing, error: pricingError } = await ctx.admin
      .from("tenant_pricing")
      .select("locale, currency, amount_cents, source")
      .eq("tenant_id", ctx.tenantId)
      .eq("product_id", params.id)

    // Surfaced, not swallowed: an unreadable pricing table must not look like an unpriced product.
    if (pricingError) return queryFailed("v1/products/[id]:pricing", pricingError) as NextResponse

    return NextResponse.json({ ...data, pricing: pricing ?? [] })
  })
}

/**
 * PATCH /v1/products/{id} — change named fields on a product, and nothing else.
 *
 * READ-MERGE-WRITE, deliberately. `tenant_products_upsert` overwrites twenty columns from
 * `EXCLUDED`, so "send only what changed" is exactly the shape that nulls the rest — store ids
 * included, which would detach a live Play/App Store listing from the row that syncs it. The merge
 * therefore reads the current row, applies only the named fields, and sends the whole thing back.
 * Doing that correctly in one place is most of the reason this endpoint exists.
 *
 * `sku` is immutable here: it is the upsert's conflict key, so "renaming" it would INSERT a second
 * product and leave the original synced and sellable. Retire the old one and create a new one.
 *
 * CLEARING `trial_per_platform`. Send `{"trial_per_platform": null}`. That map wins over
 * `trial_duration_days` whenever it is non-empty, so a stale one makes a product serve a trial
 * length its own catalogue entry disowns — and before this endpoint there was no way to empty it
 * through the API at all.
 */
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const productId = params.id

  return withApiKey(req, "products:write", async (ctx) => {
    let patch: Record<string, unknown>
    try {
      patch = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: "body_must_be_json" }, { status: 400 })
    }
    if (typeof patch !== "object" || patch === null || Array.isArray(patch)) {
      return NextResponse.json({ error: "body_must_be_an_object" }, { status: 400 })
    }
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "body_must_name_at_least_one_field" }, { status: 400 })
    }
    if ("sku" in patch) {
      return NextResponse.json(
        {
          error: "sku_immutable",
          detail:
            "sku is the natural key of the upsert; changing it would create a second product and " +
            "leave this one synced and sellable. Retire this product and create a new one.",
        },
        { status: 400 },
      )
    }

    const { data: existing, error: lookupError } = await ctx.admin
      .from("tenant_products")
      .select(
        "id, sku, type, display_name, trial_enabled, trial_duration_days, trial_per_platform, " +
          "attaches_to_product_id, interval, base_price_cents, base_currency, display_order, active, " +
          "pricing_mode, global_price_cents, global_currency, discount_percent, discount_ends_at, " +
          "play_product_id, app_store_product_id",
      )
      .eq("tenant_id", ctx.tenantId)
      .eq("id", productId)
      .maybeSingle()
    if (lookupError) return queryFailed("v1/products/[id]:lookup", lookupError) as NextResponse
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 })

    const row = existing as unknown as Record<string, unknown>
    const built = buildProductRow(ctx.tenantId, String(row.sku), row, patch)
    if ("error" in built) return NextResponse.json(built, { status: 400 })

    const { error: rpcError } = await ctx.admin.rpc("tenant_products_upsert", {
      p_row: toRpcRow(built.row),
    })
    if (rpcError) return queryFailed("v1/products/[id]:upsert", rpcError) as NextResponse

    const changed = Object.keys(patch)
    await auditApiAction(ctx, "product.update", "tenant_products", { id: productId, fields: changed })

    // A catalogue change is not a storefront change. Anything a provider mirrors — price, trial
    // length, title, active — only reaches buyers on the next sync, so the caller is told rather
    // than left to assume the store already agrees.
    const providerVisible = changed.some((k) =>
      ["display_name", "trial_enabled", "trial_duration_days", "trial_per_platform", "base_price_cents", "base_currency", "active"].includes(k),
    )
    return NextResponse.json({
      id: productId,
      sku: row.sku,
      updated: changed,
      synced: false,
      ...(providerVisible
        ? { next: `POST /v1/products/${productId}/sync — the storefronts still serve the previous values until then.` }
        : {}),
    })
  })
}
