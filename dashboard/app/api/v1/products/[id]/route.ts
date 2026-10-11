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
