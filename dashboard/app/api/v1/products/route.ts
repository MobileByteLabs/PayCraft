import { NextResponse } from "next/server"
import { listResource, withApiKey } from "@/lib/api-v1-helpers"
import { auditApiAction } from "@/lib/api-key-auth"
import { queryFailed } from "@/lib/api-security"
import { buildProductRow, toRpcRow } from "@/lib/product-write"
export const dynamic = "force-dynamic"

/** Every column `buildProductRow` must see to merge without nulling something. */
const PRODUCT_WRITE_COLUMNS =
  "id, sku, type, display_name, trial_enabled, trial_duration_days, trial_per_platform, " +
  "attaches_to_product_id, interval, base_price_cents, base_currency, display_order, active, " +
  "pricing_mode, global_price_cents, global_currency, discount_percent, discount_ends_at, " +
  "play_product_id, app_store_product_id, grant_quantity"

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

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
      "grant_quantity, " +
      "trial_enabled, trial_duration_days, trial_per_platform, stripe_product_id, stripe_price_id_by_currency, " +
      "razorpay_plan_id_by_currency, razorpay_plan_id_by_currency_test, live_plan_ids_verified, " +
      "play_product_id, app_store_product_id, sync_state, created_at, updated_at",
    orderBy: { column: "created_at", ascending: false },
    filters: (q) => ({ sku: q.get("sku"), type: q.get("type") }),
  })
}

/**
 * POST /v1/products — create a product.
 *
 * The create half of the catalogue lifecycle. Until this existed the API could read a catalogue it
 * had no way to build, so onboarding a fresh app meant calling `tenant_products_upsert` over a
 * direct `psql` session — which put catalogue creation outside the API, outside its scopes, and
 * outside its audit log.
 *
 * DEFAULTS TO REFUSING AN EXISTING SKU. The underlying RPC is an upsert on `(tenant_id, sku)`, so
 * a create against a live SKU would silently rewrite a product that may already be synced to three
 * storefronts. Pass `upsert: true` to mean it on purpose; the response says which happened.
 */
export async function POST(req: Request) {
  return withApiKey(req, "products:write", async (ctx) => {
    let body: Record<string, unknown>
    try {
      body = (await req.json()) as Record<string, unknown>
    } catch {
      return NextResponse.json({ error: "body_must_be_json" }, { status: 400 })
    }
    if (!isPlainObject(body)) return NextResponse.json({ error: "body_must_be_an_object" }, { status: 400 })

    const sku = String(body.sku ?? "").trim()
    if (!sku) return NextResponse.json({ error: "sku_required" }, { status: 400 })
    if (!/^[A-Za-z0-9._-]{1,128}$/.test(sku)) {
      return NextResponse.json(
        { error: "sku_invalid", detail: "letters, digits, dot, underscore, hyphen; max 128" },
        { status: 400 },
      )
    }
    const upsert = body.upsert === true
    const { sku: _sku, upsert: _upsert, ...patch } = body

    const { data: existing, error: lookupError } = await ctx.admin
      .from("tenant_products")
      .select(PRODUCT_WRITE_COLUMNS)
      .eq("tenant_id", ctx.tenantId)
      .eq("sku", sku)
      .maybeSingle()
    if (lookupError) return queryFailed("v1/products:lookup", lookupError) as NextResponse

    if (existing && !upsert) {
      return NextResponse.json(
        {
          error: "sku_already_exists",
          id: (existing as unknown as Record<string, unknown>).id,
          detail:
            "This SKU is already in the catalogue and may be synced to live storefronts. " +
            "Send upsert:true to update it, or PATCH /v1/products/{id} to change named fields only.",
        },
        { status: 409 },
      )
    }

    const built = buildProductRow(
      ctx.tenantId,
      sku,
      (existing as unknown as Record<string, unknown> | null) ?? null,
      patch,
    )
    if ("error" in built) return NextResponse.json(built, { status: 400 })

    const { data: id, error: rpcError } = await ctx.admin.rpc("tenant_products_upsert", {
      p_row: toRpcRow(built.row),
    })
    if (rpcError) return queryFailed("v1/products:upsert", rpcError) as NextResponse

    await auditApiAction(ctx, existing ? "product.update" : "product.create", "tenant_products", {
      id,
      sku,
    })

    return NextResponse.json(
      {
        id,
        sku,
        created: !existing,
        // The catalogue row exists; the STOREFRONTS do not know about it yet. Saying so prevents
        // the "it's in PayCraft so it must be on sale" reading that `sync_status` alone invites.
        synced: false,
        next: `POST /v1/products/${id}/sync to push it to the connected providers.`,
      },
      { status: existing ? 200 : 201 },
    )
  })
}
