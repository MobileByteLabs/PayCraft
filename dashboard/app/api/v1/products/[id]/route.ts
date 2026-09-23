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

    const { data: pricing } = await ctx.admin
      .from("tenant_pricing")
      .select("currency, amount_cents, country_code")
      .eq("tenant_id", ctx.tenantId)
      .eq("product_id", params.id)

    return NextResponse.json({ ...data, pricing: pricing ?? [] })
  })
}
