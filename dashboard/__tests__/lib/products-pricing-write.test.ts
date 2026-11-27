/**
 * `PUT /v1/products/{id}/pricing` — the write side `products:write` was defined for and nothing
 * implemented.
 *
 * WHY THIS ENDPOINT EXISTS, measured on cappy 2026-10-11: `sub.week` and `sub.quarter` reached
 * Google Play with a SINGLE US region and were unbuyable in India — Play reported both base plans
 * ACTIVE, so nothing looked wrong until a buyer tapped Subscribe. The cause is that a product with
 * no `tenant_pricing` rows syncs with `[{base_currency, base_price_cents}]`, i.e. one currency, and
 * the only route able to write those rows was session-authenticated. An agent could read and
 * re-sync a catalogue it could never author.
 *
 * The validation here is deliberately strict and deliberately tested: these numbers become what a
 * store CHARGES, so every rejection below is a charge that cannot happen by accident.
 */
import { PUT } from "@/app/api/v1/products/[id]/pricing/route"
import { NextResponse } from "next/server"

const TENANT = "11111111-1111-1111-1111-111111111111"
const PRODUCT = "22222222-2222-2222-2222-222222222222"

let upserted: { rows?: unknown[] } = {}
let audited: Array<{ action: string; after?: Record<string, unknown> }> = []
let scopeAsked: string | undefined
let ownedRow: { id: string; sku: string } | null = { id: PRODUCT, sku: "sub.week" }
let storedPricing: unknown[] = []

jest.mock("@/lib/api-v1-helpers", () => ({
  __esModule: true,
  badProductId: jest.requireActual("@/lib/api-v1-helpers").badProductId,
  withApiKey: async (req: Request, scope: string, fn: (ctx: unknown) => Promise<unknown>) => {
    scopeAsked = scope
    // Chainable stub shaped like the two queries the route makes (ownership, then read-back).
    const admin = {
      from(table: string) {
        const q: Record<string, unknown> = { _table: table }
        for (const m of ["select", "eq"]) q[m] = () => q
        q.maybeSingle = async () => ({ data: ownedRow, error: null })
        // The read-back resolves the array directly off the builder.
        ;(q as { then: unknown }).then = (res: (v: unknown) => unknown) =>
          res({ data: storedPricing, error: null })
        return q
      },
      rpc: async (name: string, args: Record<string, unknown>) => {
        if (name === "tenant_pricing_bulk_upsert") {
          upserted = { rows: args.p_rows as unknown[] }
          return { data: (args.p_rows as unknown[]).length, error: null }
        }
        return { data: null, error: null }
      },
    }
    return fn({ tenantId: TENANT, keyId: "k", scopes: [scope], accountScoped: false, reachableTenantIds: [TENANT], admin })
  },
}))

jest.mock("@/lib/api-key-auth", () => ({
  __esModule: true,
  auditApiAction: async (_ctx: unknown, action: string, _resource: string, after?: Record<string, unknown>) => {
    audited.push({ action, after })
  },
}))

jest.mock("@/lib/api-security", () => ({
  __esModule: true,
  queryFailed: () => NextResponse.json({ error: "query_failed" }, { status: 500 }),
}))

const put = (rows: unknown) =>
  PUT(
    new Request(`https://x.test/api/v1/products/${PRODUCT}/pricing`, {
      method: "PUT",
      body: JSON.stringify({ rows }),
    }),
    { params: Promise.resolve({ id: PRODUCT }) },
  )

beforeEach(() => {
  upserted = {}
  audited = []
  scopeAsked = undefined
  ownedRow = { id: PRODUCT, sku: "sub.week" }
  storedPricing = []
})

describe("PUT /v1/products/{id}/pricing", () => {
  it("is gated on products:write, not a read or sync scope", async () => {
    await put([{ locale: "IN", currency: "INR", amount_cents: 8999 }])
    // The whole point of migration 150's split: a reporting token must not be able to price a product.
    expect(scopeAsked).toBe("products:write")
  })

  it("writes the rows and reports what the catalogue now IS, not what was asked", async () => {
    storedPricing = [{ locale: "IN", currency: "INR", amount_cents: 8999, source: "manual" }]
    const res = await put([{ locale: "IN", currency: "INR", amount_cents: 8999 }])
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(upserted.rows).toEqual([
      { locale: "IN", currency: "INR", amount_cents: 8999, source: "manual" },
    ])
    // Read back from the table, so a lying write cannot report success.
    expect(body.pricing).toEqual(storedPricing)
    expect(body.rows_written).toBe(1)
  })

  it("states that nothing reached a store yet, and names the call that does", async () => {
    // The cappy failure was believing a saved price meant a buyable product. The response has to
    // say otherwise in a field, not in prose a caller can skip.
    const body = await (await put([{ locale: "IN", currency: "INR", amount_cents: 8999 }])).json()
    expect(body.synced).toBe(false)
    expect(body.next).toBe(`POST /v1/products/${PRODUCT}/sync`)
  })

  it("normalises locale and currency to upper case", async () => {
    await put([{ locale: "in", currency: "inr", amount_cents: 8999 }])
    expect(upserted.rows).toEqual([
      { locale: "IN", currency: "INR", amount_cents: 8999, source: "manual" },
    ])
  })

  it("refuses a zero-decimal currency rather than guessing the unit", async () => {
    // JPY has no minor unit, so `amount_cents` is ambiguous — and the /config fallback already
    // derives JPY 32900 for a weekly plan priced at JPY 800/month. Accepting it risks a 100x
    // overcharge on a live listing.
    const res = await put([{ locale: "JP", currency: "JPY", amount_cents: 32900 }])
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("zero_decimal_currency_unsupported")
  })

  it("refuses a currency no store region maps to", async () => {
    // A row in an unmapped currency writes successfully and then no store ever reads it — the
    // failure mode that looks exactly like success.
    const res = await put([{ locale: "CH", currency: "CHF", amount_cents: 500 }])
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("not_mappable_to_a_store_region")
  })

  it("accepts a real IDR price in minor units (the flat cap refused Rp 895,455)", async () => {
    const res = await put([{ locale: "ID", currency: "IDR", amount_cents: 89_545_500 }])
    expect(res.status).toBe(200)
  })

  it("still refuses an implausible IDR amount — the cap scales with the currency, it is not gone", async () => {
    // Same ~$100,000 ceiling the flat cap gives USD, in rupiah: Rp 1,000,000,000 is over it.
    const res = await put([{ locale: "ID", currency: "IDR", amount_cents: 100_000_000_000 }])
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("implausibly_large")
  })

  it("accepts every currency the Play sync maps, incl. COP / ETB / MNT", async () => {
    const res = await put([
      { locale: "CO", currency: "COP", amount_cents: 2_970_000 },
      { locale: "ET", currency: "ETB", amount_cents: 63_234 },
      { locale: "MN", currency: "MNT", amount_cents: 1_420_000 },
    ])
    expect(res.status).toBe(200)
  })

  it("answers 400 invalid_product_id for a non-UUID id instead of a 500 from Postgres", async () => {
    // A sku, or the "undefined" an MCP call without `id` produces, used to reach the uuid column
    // and come back as a generic query_failed 500.
    for (const id of ["pro-lifetime", "undefined"]) {
      const res = await PUT(
        new Request(`https://x.test/api/v1/products/${id}/pricing`, {
          method: "PUT",
          body: JSON.stringify({ rows: [{ locale: "IN", currency: "INR", amount_cents: 8999 }] }),
        }),
        { params: Promise.resolve({ id }) },
      )
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe("invalid_product_id")
    }
    expect(upserted.rows).toBeUndefined() // nothing written
  })

  it("refuses two rows for the same locale", async () => {
    // UNIQUE(tenant_id, product_id, locale) makes this order-dependent; the loser would vanish.
    const res = await put([
      { locale: "IN", currency: "INR", amount_cents: 8999 },
      { locale: "IN", currency: "INR", amount_cents: 9999 },
    ])
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain("locale_duplicated")
  })

  it.each([
    ["a non-integer amount", { locale: "IN", currency: "INR", amount_cents: 89.99 }, "must_be_an_integer"],
    ["a zero amount", { locale: "IN", currency: "INR", amount_cents: 0 }, "must_be_positive"],
    ["a negative amount", { locale: "IN", currency: "INR", amount_cents: -1 }, "must_be_positive"],
    ["a malformed locale", { locale: "IND", currency: "INR", amount_cents: 8999 }, "iso_3166"],
    ["a malformed currency", { locale: "IN", currency: "RUPEE", amount_cents: 8999 }, "iso_4217"],
  ])("refuses %s", async (_label, row, expected) => {
    const res = await put([row])
    expect(res.status).toBe(400)
    expect((await res.json()).error).toContain(expected)
  })

  it("refuses an empty row set instead of writing nothing and reporting success", async () => {
    const res = await put([])
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe("rows_must_not_be_empty")
  })

  it("404s a product the key's tenant does not own, before parsing the body", async () => {
    ownedRow = null
    const res = await put([{ locale: "IN", currency: "INR", amount_cents: 8999 }])
    expect(res.status).toBe(404)
    expect(upserted.rows).toBeUndefined()
  })

  it("audits the write against the key, with the locales it touched", async () => {
    await put([
      { locale: "IN", currency: "INR", amount_cents: 8999 },
      { locale: "GB", currency: "GBP", amount_cents: 299 },
    ])
    expect(audited).toHaveLength(1)
    expect(audited[0].action).toBe("pricing.bulk_upserted")
    expect(audited[0].after?.locales).toEqual(["IN", "GB"])
  })

  it("does not audit a rejected write", async () => {
    await put([{ locale: "JP", currency: "JPY", amount_cents: 32900 }])
    expect(audited).toHaveLength(0)
  })
})
