/**
 * Integration tests for `POST /api/products`.
 *
 * Mocks the Supabase server client and the per-provider sync helpers, then
 * invokes the route handler directly with a NextRequest. Verifies:
 *
 *   1. Valid POST → 200 + product upserted + Stripe sync invoked +
 *      payment_links persisted via `tenant_providers_set_payment_links` RPC
 *   2. POST without Stripe connected → product created, NO Stripe sync
 *      (helper short-circuits on missing `tenant_stripe_provider_status.source`)
 *   3. Invalid POST (no body / DB upsert fails) → 500 / error JSON
 *   4. POST when Stripe sync throws → product still upserted; sync helper
 *      catches and logs (best-effort) — route response is still 200
 *
 * NOTE on response codes — the live route returns 200 with `{ id }` rather
 * than 201; the tests assert the actual contract not the GOAL.md draft.
 */

// ---- Mock setup must precede the route import ----------------------------

const supabaseRpcCalls: Array<{ fn: string; args: any }> = []
const supabaseRpc = jest.fn()
const supabaseFromUpdate = jest.fn(() => ({ eq: () => ({ eq: () => ({}) }) }))

function makeSupabase(overrides: Partial<Record<string, any>> = {}) {
  return {
    rpc: supabaseRpc,
    from: jest.fn(() => ({ update: supabaseFromUpdate })),
    ...overrides,
  }
}

jest.mock("@/lib/supabase-server", () => ({
  createClient: jest.fn(() => makeSupabase()),
}))

jest.mock("@/lib/tenant", () => ({
  requireTenant: jest.fn(async () => ({
    tenant: { id: "tenant-abc", livemode: false, name: "TestApp" },
    userId: "user-xyz",
  })),
}))

// Mock the per-provider sync helpers so the route can drive them without
// needing the full Stripe SDK / RPC chain. Each mock records its invocation
// in the supabaseRpcCalls log + writes the same RPCs the real helper would.
const stripeSyncSpy = jest.fn(async (supabase: any, opts: any) => {
  // Real helper short-circuits if tenant has no Stripe connection — we honor
  // the same gate here by checking the test-controlled flag.
  if (!(globalThis as any).__stripeConnected) return
  await supabase.rpc("tenant_products_set_stripe_ids", {
    p_id: opts.productId,
    p_stripe_product_id: "prod_synced",
    p_stripe_price_id_by_currency: { USD: "price_synced_USD" },
  })
  await supabase.rpc("tenant_providers_set_payment_links", {
    p_tenant_id: opts.tenantId,
    p_provider: "stripe",
    p_mode: "test",
    p_payment_links: { USD: "https://buy.stripe.com/test_link" },
  })
})
const razorpaySyncSpy = jest.fn(async () => {})
const cashfreeSyncSpy = jest.fn(async () => {})

jest.mock("@/lib/stripe-route-helper", () => ({
  stripeSyncProduct: stripeSyncSpy,
  razorpaySyncProduct: razorpaySyncSpy,
  cashfreeSyncProduct: cashfreeSyncSpy,
}))

// Stripe SDK is imported transitively by the route — neutralize it.
jest.mock("stripe", () => ({ __esModule: true, default: class FakeStripe {} }))

// next/server is real (provided by `next` package); but if not resolvable in
// the test env we fall back to a minimal shim.
let POST: (req: any) => Promise<any>
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  POST = require("../../../app/api/products/route").POST
} catch (e) {
  POST = (async () => {
    throw new Error("Route not loadable: " + (e as Error).message)
  }) as any
}

// ---- Helpers -------------------------------------------------------------

/**
 * Build a minimal NextRequest-shaped object — the route only calls
 * `req.json()` so a plain object is sufficient.
 */
function makeReq(body: any) {
  return { json: async () => body } as any
}

/** Drain the microtask queue so `void Promise.all([...])` settles. */
async function flushMicrotasks() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r))
}

beforeEach(() => {
  supabaseRpc.mockReset()
  supabaseFromUpdate.mockReset()
  supabaseRpcCalls.length = 0
  stripeSyncSpy.mockClear()
  razorpaySyncSpy.mockClear()
  cashfreeSyncSpy.mockClear()
  ;(globalThis as any).__stripeConnected = true

  // Default RPC behavior — upsert returns the new ID, audit + pricing rows succeed,
  // stripe sync RPCs succeed.
  supabaseRpc.mockImplementation((fn: string, args: any) => {
    supabaseRpcCalls.push({ fn, args })
    if (fn === "tenant_products_upsert") return Promise.resolve({ data: "new-product-id", error: null })
    return Promise.resolve({ data: null, error: null })
  })
})

// ---- Tests ---------------------------------------------------------------

describe("POST /api/products — happy path", () => {
  it("upserts product + invokes Stripe sync + persists payment_links via RPC", async () => {
    const body = {
      display_name: "Pro Plan",
      type: "subscription",
      interval: "month",
      pricing_rows: [{ currency: "USD", amount_cents: 999 }],
    }
    const res = await POST(makeReq(body))

    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json).toEqual({ id: "new-product-id" })

    // Upsert was called with tenant_id stamped + pricing_rows stripped.
    const upsertCall = supabaseRpcCalls.find((c) => c.fn === "tenant_products_upsert")
    expect(upsertCall).toBeDefined()
    expect(upsertCall!.args.p_row).toMatchObject({
      display_name: "Pro Plan",
      type: "subscription",
      interval: "month",
      tenant_id: "tenant-abc",
    })
    expect(upsertCall!.args.p_row).not.toHaveProperty("pricing_rows")

    // audit_log_emit fired for product.created.
    const auditCall = supabaseRpcCalls.find(
      (c) => c.fn === "audit_log_emit" && c.args.p_action === "product.created",
    )
    expect(auditCall).toBeDefined()

    // pricing rows persisted via bulk-upsert.
    const pricingCall = supabaseRpcCalls.find((c) => c.fn === "tenant_pricing_bulk_upsert")
    expect(pricingCall).toBeDefined()
    expect(pricingCall!.args.p_rows).toEqual([{ currency: "USD", amount_cents: 999 }])

    // Stripe sync was invoked.
    await flushMicrotasks()
    expect(stripeSyncSpy).toHaveBeenCalledTimes(1)
    expect(stripeSyncSpy.mock.calls[0][1]).toMatchObject({
      tenantId: "tenant-abc",
      productId: "new-product-id",
      body,
    })

    // Stripe payment-links RPC fired through the mocked helper.
    const linkRpcCall = supabaseRpcCalls.find(
      (c) => c.fn === "tenant_providers_set_payment_links" && c.args.p_provider === "stripe",
    )
    expect(linkRpcCall).toBeDefined()
    expect(linkRpcCall!.args.p_payment_links).toEqual({
      USD: "https://buy.stripe.com/test_link",
    })
  })
})

describe("POST /api/products — Stripe not connected", () => {
  it("creates product but does NOT fire Stripe payment-links RPC", async () => {
    ;(globalThis as any).__stripeConnected = false

    const body = {
      display_name: "No-Stripe Plan",
      type: "subscription",
      interval: "month",
      pricing_rows: [{ currency: "USD", amount_cents: 999 }],
    }
    const res = await POST(makeReq(body))

    expect(res.status).toBe(200)
    expect((await res.json()).id).toBe("new-product-id")

    await flushMicrotasks()
    // Helper was *invoked* (route always fires Promise.all), but the helper
    // itself short-circuited — no payment-links RPC was emitted.
    expect(stripeSyncSpy).toHaveBeenCalledTimes(1)
    const linkRpcCall = supabaseRpcCalls.find(
      (c) => c.fn === "tenant_providers_set_payment_links" && c.args.p_provider === "stripe",
    )
    expect(linkRpcCall).toBeUndefined()
    // tenant_products_set_stripe_ids was also skipped.
    expect(
      supabaseRpcCalls.find((c) => c.fn === "tenant_products_set_stripe_ids"),
    ).toBeUndefined()
  })
})

describe("POST /api/products — invalid body (upsert error)", () => {
  it("returns 500 with the DB error message", async () => {
    supabaseRpc.mockImplementationOnce((fn: string, args: any) => {
      supabaseRpcCalls.push({ fn, args })
      return Promise.resolve({
        data: null,
        error: { message: "violates not-null constraint: display_name" },
      })
    })

    const res = await POST(makeReq({})) // empty body → DB rejects

    expect(res.status).toBe(500)
    const json = await res.json()
    expect(json).toEqual({ error: "violates not-null constraint: display_name" })

    // Stripe sync MUST NOT fire when upsert failed.
    expect(stripeSyncSpy).not.toHaveBeenCalled()
  })
})

describe("POST /api/products — Stripe sync failure does not break product create", () => {
  it("still returns 200 + product id when Stripe helper internally swallows a failure", async () => {
    // The REAL `stripeSyncProduct` wraps every Stripe call in try/catch and
    // only logs failures (best-effort sync, see lib/stripe-route-helper.ts:72).
    // We mirror that contract in the mock: simulate the helper catching a
    // network error internally — payment-links RPC is therefore NEVER fired,
    // but the helper itself does NOT reject. This matches the production
    // behavior where the user's product create never fails due to a flaky
    // Stripe API.
    const consoleErr = jest.spyOn(console, "error").mockImplementation(() => {})
    stripeSyncSpy.mockImplementationOnce(async () => {
      try {
        throw new Error("network: stripe.com unreachable")
      } catch (e: any) {
        console.error("[products] stripe sync failed:", e.message)
      }
    })

    const body = {
      display_name: "Flaky Sync Plan",
      type: "subscription",
      interval: "month",
      pricing_rows: [{ currency: "USD", amount_cents: 1500 }],
    }
    const res = await POST(makeReq(body))

    // Product was still created.
    expect(res.status).toBe(200)
    expect((await res.json()).id).toBe("new-product-id")
    const upsertCall = supabaseRpcCalls.find((c) => c.fn === "tenant_products_upsert")
    expect(upsertCall).toBeDefined()

    await flushMicrotasks()
    expect(stripeSyncSpy).toHaveBeenCalledTimes(1)

    // No payment-links RPC fired (because the helper caught the error before
    // reaching the RPC). This is the "sync_status: failed" world — product
    // exists in DB, Stripe has no record.
    expect(
      supabaseRpcCalls.find((c) => c.fn === "tenant_providers_set_payment_links"),
    ).toBeUndefined()

    // The helper logged the failure (operator visibility).
    expect(consoleErr).toHaveBeenCalledWith(
      "[products] stripe sync failed:",
      "network: stripe.com unreachable",
    )
    consoleErr.mockRestore()
  })
})
