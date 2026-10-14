/**
 * `POST /v1/products/{id}/retire` — the half of the catalogue lifecycle that did not exist.
 *
 * `tenant_products_needs_sync` filters `AND p.active = TRUE`, so deactivating a product in PayCraft
 * removes it from every drain and no storefront is ever told. Measured on cappy 2026-10-11:
 * `cappy_plus_guardian` was `active=false` locally while Google Play still listed it ACTIVE, priced
 * across 7 regions and sellable.
 *
 * The two properties worth pinning are ORDER (providers before the local flag — the reverse
 * re-creates the bug) and the SUBSCRIBER REFUSAL (stopping sales on a live cohort is the operator's
 * decision, not the drain's).
 */
import { POST } from "@/app/api/v1/products/[id]/retire/route"
import { NextResponse } from "next/server"

const TENANT = "11111111-1111-1111-1111-111111111111"
const PRODUCT = "22222222-2222-2222-2222-222222222222"

let productRow: Record<string, unknown> | null
let subCount: number
let subError: unknown
let updates: Array<Record<string, unknown>>
let retireCalls: string[]
let retireResult: Record<string, unknown>
let storeConnected: boolean
let order: string[]
let audited: Array<{ action: string }>
let scopeAsked: string | undefined

jest.mock("@/lib/googleplay-product-sync", () => ({
  __esModule: true,
  retireGooglePlaySubscription: jest.fn(async (_creds: unknown, playProductId: string) => {
    retireCalls.push(playProductId)
    order.push("provider")
    return retireResult
  }),
}))

jest.mock("@/lib/api-v1-helpers", () => ({
  __esModule: true,
  withApiKey: async (req: Request, scope: string, fn: (ctx: unknown) => Promise<unknown>) => {
    scopeAsked = scope
    const admin = {
      from(table: string) {
        const q: Record<string, unknown> = {}
        for (const m of ["select", "eq", "in"]) q[m] = () => q
        q.maybeSingle = async () => ({ data: productRow, error: null })
        q.update = (vals: Record<string, unknown>) => {
          order.push("local")
          updates.push({ table, ...vals })
          const u: Record<string, unknown> = {}
          u.eq = () => u
          ;(u as { then: unknown }).then = (res: (v: unknown) => unknown) => res({ error: null })
          return u
        }
        // head:true count query resolves off the builder
        ;(q as { then: unknown }).then = (res: (v: unknown) => unknown) =>
          res({ count: subCount, error: subError })
        return q
      },
      rpc: (name: string) => ({
        single: async () =>
          name === "tenant_providers_store_status"
            ? { data: { connected: storeConnected, config: {} } }
            : { data: { credential: "{}", config: { package_name: "com.x.y" } } },
        then: (res: (v: unknown) => unknown) => res({ data: null, error: null }),
      }),
    }
    return fn({ tenantId: TENANT, keyId: "k", scopes: [scope], accountScoped: false, reachableTenantIds: [TENANT], admin })
  },
}))

jest.mock("@/lib/api-key-auth", () => ({
  __esModule: true,
  auditApiAction: async (_c: unknown, action: string) => { audited.push({ action }) },
}))

jest.mock("@/lib/api-security", () => ({
  __esModule: true,
  queryFailed: () => NextResponse.json({ error: "query_failed" }, { status: 500 }),
}))

const retire = () =>
  POST(new Request(`https://x.test/api/v1/products/${PRODUCT}/retire`, { method: "POST" }), {
    params: { id: PRODUCT },
  })

beforeEach(() => {
  productRow = {
    id: PRODUCT, sku: "com.x.y.sub.guardian", display_name: "X Guardian",
    active: true, play_product_id: "com.x.y.sub.guardian", app_store_product_id: null,
  }
  subCount = 0
  subError = null
  updates = []
  retireCalls = []
  retireResult = { retired: true, alreadyInactive: false, basePlans: ["bp-autorenew"] }
  storeConnected = true
  order = []
  audited = []
  scopeAsked = undefined
})

describe("POST /v1/products/{id}/retire", () => {
  it("is gated on products:write", async () => {
    await retire()
    expect(scopeAsked).toBe("products:write")
  })

  it("stops the STORE before marking the row inactive", async () => {
    // The whole reason the bug existed: a row flipped inactive first drops out of
    // tenant_products_needs_sync, so the store is never reached and keeps selling.
    await retire()
    expect(order).toEqual(["provider", "local"])
  })

  it("deactivates the Play product by its pinned store id, not the sku", async () => {
    // A legacy product's Play id and sku diverge (cappy: sku cappy_plus_guardian,
    // play com.mobilebytesensei.cappy.sub.guardian). Retiring by sku would miss it entirely.
    productRow = { ...(productRow as object), sku: "legacy_sku", play_product_id: "com.x.y.sub.guardian" }
    await retire()
    expect(retireCalls).toEqual(["com.x.y.sub.guardian"])
  })

  it("reports retired_everywhere and flips the local row", async () => {
    const body = await (await retire()).json()
    expect(body.retired_everywhere).toBe(true)
    expect(body.deactivated).toBe(true)
    expect(updates).toEqual([{ table: "tenant_products", active: false }])
  })

  it("REFUSES with 409 when the product has live subscribers, and touches nothing", async () => {
    subCount = 3
    const res = await retire()
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toBe("product_retire_has_subscribers")
    expect(body.subscribers).toBe(3)
    // Neither the store nor the row may be touched on the refusal path.
    expect(retireCalls).toEqual([])
    expect(updates).toEqual([])
  })

  it("fails CLOSED when the subscriber count cannot be read", async () => {
    // A guard that cannot run is not a guard. Retiring blind could strand a paying cohort.
    subError = { message: "boom" }
    const res = await retire()
    expect(res.status).toBe(500)
    expect(retireCalls).toEqual([])
    expect(updates).toEqual([])
  })

  it("does NOT mark the row inactive when the store refused", async () => {
    // Otherwise the product vanishes from the drain while still on sale — the original bug, now
    // reachable through the very endpoint meant to end it.
    retireResult = { retired: false, alreadyInactive: false, basePlans: [], error: "play said no" }
    const body = await (await retire()).json()
    expect(body.deactivated).toBe(false)
    expect(body.retired_everywhere).toBe(false)
    expect(updates).toEqual([])
  })

  it("is idempotent on an already-inactive product", async () => {
    productRow = { ...(productRow as object), active: false }
    retireResult = { retired: true, alreadyInactive: true, basePlans: [] }
    const body = await (await retire()).json()
    expect(body.deactivated).toBe(true)
    expect(updates).toEqual([])          // nothing to write
    expect(retireCalls).toHaveLength(1)  // but the store IS still reconciled — guardian's exact case
  })

  it("skips Play when the store is not connected, without claiming success", async () => {
    storeConnected = false
    const body = await (await retire()).json()
    expect(body.providers.google_play.skipped).toBe(true)
    expect(body.retired_everywhere).toBe(false)
  })

  it("names App Store as unimplemented rather than omitting it", async () => {
    // A silent absence would read as "nothing to do" and leave an iOS product on sale.
    productRow = { ...(productRow as object), app_store_product_id: "com.x.y.sub.guardian" }
    const body = await (await retire()).json()
    expect(body.providers.app_store.skipped).toBe(true)
    expect(body.retired_everywhere).toBe(false)
  })

  it("404s a product this tenant does not own", async () => {
    productRow = null
    expect((await retire()).status).toBe(404)
    expect(retireCalls).toEqual([])
  })

  it("audits the retire", async () => {
    await retire()
    expect(audited).toEqual([{ action: "product.retired" }])
  })
})
