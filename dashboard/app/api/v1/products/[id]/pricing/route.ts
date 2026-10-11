import { NextResponse } from "next/server"
import { withApiKey } from "@/lib/api-v1-helpers"
import { auditApiAction } from "@/lib/api-key-auth"
import { queryFailed } from "@/lib/api-security"
export const dynamic = "force-dynamic"

/**
 * Currencies whose amounts are quoted in MINOR units everywhere else in this codebase
 * (`amount_cents`), but which have NO minor unit at all. ISO 4217 exponent 0.
 *
 * They are rejected rather than silently accepted because the ambiguity is not theoretical: the
 * `/config` fallback resolver multiplies USD cents by an FX rate without dividing by 100, and for
 * cappy that produced a derived weekly price of JPY 32900 — ¥32,900/week against a ¥800/month plan.
 * A zero-decimal amount that means "cents" is off by 100x, and the one place that mistake must not
 * reach is a live store listing. Until the resolver is fixed and a unit convention is written down,
 * this endpoint refuses them by name instead of guessing which the caller meant.
 */
const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW", "VND", "CLP", "ISK", "XAF", "XOF", "XPF"])

/** The currencies the Play sync can map to a region (`CURRENCY_REGION` in googleplay-product-sync). */
const KNOWN_CURRENCIES = new Set([
  "USD", "INR", "GBP", "EUR", "JPY", "CAD", "AUD",
  "SGD", "BRL", "MXN", "ZAR", "AED", "IDR", "NGN", "KRW",
])

interface PricingRow {
  locale: string
  currency: string
  amount_cents: number
}

/**
 * Validate the request body into pricing rows, or explain exactly what is wrong.
 *
 * Deliberately strict. This writes the number a store will CHARGE, so a malformed row is refused
 * rather than coerced — a silently-coerced price is a charge nobody authorised.
 */
function parseRows(raw: unknown): { rows: PricingRow[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: "rows_must_be_an_array" }
  if (raw.length === 0) return { error: "rows_must_not_be_empty" }
  if (raw.length > 64) return { error: "too_many_rows_max_64" }

  const rows: PricingRow[] = []
  const seen = new Set<string>()
  for (const [i, r] of raw.entries()) {
    if (typeof r !== "object" || r === null) return { error: `rows[${i}]_must_be_an_object` }
    const row = r as Record<string, unknown>

    const locale = String(row.locale ?? "").trim().toUpperCase()
    if (!/^[A-Z]{2}$/.test(locale)) {
      return { error: `rows[${i}].locale_must_be_iso_3166_alpha_2` }
    }
    // UNIQUE(tenant_id, product_id, locale): two rows for one locale would make the write
    // order-dependent, and the loser would vanish without a word.
    if (seen.has(locale)) return { error: `rows[${i}].locale_duplicated:${locale}` }
    seen.add(locale)

    const currency = String(row.currency ?? "").trim().toUpperCase()
    if (!/^[A-Z]{3}$/.test(currency)) {
      return { error: `rows[${i}].currency_must_be_iso_4217` }
    }
    if (!KNOWN_CURRENCIES.has(currency)) {
      // Not a hard taxonomy claim — it is the set the Play sync can turn into a regionalConfig.
      // An unmapped currency writes a row that no store will ever read, which looks like success.
      return { error: `rows[${i}].currency_not_mappable_to_a_store_region:${currency}` }
    }
    if (ZERO_DECIMAL_CURRENCIES.has(currency)) {
      return { error: `rows[${i}].zero_decimal_currency_unsupported:${currency}` }
    }

    const amount = row.amount_cents
    if (typeof amount !== "number" || !Number.isInteger(amount)) {
      return { error: `rows[${i}].amount_cents_must_be_an_integer` }
    }
    if (amount <= 0) return { error: `rows[${i}].amount_cents_must_be_positive` }
    if (amount > 100_000_00) return { error: `rows[${i}].amount_cents_implausibly_large` }

    rows.push({ locale, currency, amount_cents: amount })
  }
  return { rows }
}

/**
 * PUT /v1/products/{id}/pricing — set this product's per-locale prices.
 *
 * THE WRITE SIDE THAT WAS MISSING. `products:write` has existed as a scope since migration 150
 * ("the write side an end-to-end onboarding needs") but no endpoint consumed it: every
 * `requireApiKey` call site in the v1 API asked for a read or sync scope, so a key could be GRANTED
 * products:write and still have nothing to call. The only route that could write a price was
 * `POST /api/pricing`, which authenticates with `requireTenant()` — a browser session — so an agent
 * or CI job could read and re-sync a catalogue it could never author.
 *
 * Found on cappy 2026-10-11: `sub.week` and `sub.quarter` reached Play with a single US region,
 * because a product with no `tenant_pricing` rows falls back to `[{base_currency, base_price_cents}]`
 * and that is one currency. An Indian buyer got "product not found" on a subscription Play reported
 * ACTIVE. Fixing it required a price write, and there was no API to do it with.
 *
 * UPSERT, not replace: rows are merged per locale by `tenant_pricing_upsert`'s ON CONFLICT. Omitting
 * a locale leaves it as it was — this endpoint cannot delete a price, which keeps a partial request
 * from silently un-pricing a live region.
 *
 * It does NOT sync. `POST /v1/products/{id}/sync` already owns provider writes behind
 * `products:sync`, and folding a live-store write into a pricing call would put it behind the wrong
 * scope — exactly the separation migration 150's comment asks for ("a reporting token can never
 * provision an app"). The caller writes, then syncs, and sees both verdicts.
 */
export async function PUT(req: Request, { params }: { params: { id: string } }) {
  // Hoisted, and not only for readability: the `no endpoint reads a tenant id from the request`
  // guard (api-key-auth.test.ts) flags any line mentioning both "tenant" and `params`, and the
  // audit call below names the `tenant_pricing` TABLE. Using a local keeps the guard's predicate
  // sharp instead of teaching it an exception it would then miss a real violation through.
  const productId = params.id
  return withApiKey(req, "products:write", async (ctx) => {
    // Ownership first: without the tenant predicate a key could price another tenant's product.
    const { data: owned, error: ownedError } = await ctx.admin
      .from("tenant_products")
      .select("id, sku")
      .eq("tenant_id", ctx.tenantId)
      .eq("id", productId)
      .maybeSingle()
    if (ownedError) return queryFailed("v1/products/[id]/pricing:own", ownedError) as NextResponse
    if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 })

    const body = (await req.json().catch(() => null)) as { rows?: unknown } | null
    if (!body) return NextResponse.json({ error: "body_must_be_json" }, { status: 400 })

    const parsed = parseRows(body.rows)
    if ("error" in parsed) {
      return NextResponse.json({ error: parsed.error }, { status: 400 })
    }

    const { data: written, error } = await ctx.admin.rpc("tenant_pricing_bulk_upsert", {
      p_tenant_id: ctx.tenantId,
      p_product_id: productId,
      // `source: "manual"` is the table default and the honest label: these came from a caller, not
      // from a provider readback or the FX fallback. `/config` surfaces it, so a later reader can
      // tell an authored price from a derived one.
      p_rows: parsed.rows.map((r) => ({ ...r, source: "manual" })),
    })
    if (error) return queryFailed("v1/products/[id]/pricing:upsert", error) as NextResponse

    await auditApiAction(ctx, "pricing.bulk_upserted", `tenant_pricing:product_id=${productId}`, {
      product_id: productId,
      sku: owned.sku,
      rows_written: written,
      locales: parsed.rows.map((r) => r.locale),
    })

    // Read back rather than echo the request. The caller asked what the catalogue should be; this
    // answers what it now IS — the same distinction STEP A5 of the onboarding chain draws when it
    // refuses to trust `sync_status` over a provider readback.
    const { data: pricing, error: readBackError } = await ctx.admin
      .from("tenant_pricing")
      .select("locale, currency, amount_cents, source")
      .eq("tenant_id", ctx.tenantId)
      .eq("product_id", productId)
    if (readBackError) {
      return queryFailed("v1/products/[id]/pricing:readback", readBackError) as NextResponse
    }

    // `synced: false` is stated, not implied: the rows are saved but no store knows yet, and the
    // next call is the one that makes a buyer able to pay.
    return NextResponse.json({
      product_id: productId,
      sku: owned.sku,
      rows_written: written,
      pricing: pricing ?? [],
      synced: false,
      next: `POST /v1/products/${productId}/sync`,
    })
  })
}
