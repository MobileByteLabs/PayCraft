/**
 * Unit tests for `lib/stripe-product-sync.ts`.
 *
 * Verifies:
 *   1. Single-currency product → 1 Product + 1 Price + 1 Payment Link
 *   2. Multi-currency (USD/EUR/GBP) → 1 Product + 3 Prices + 3 Payment Links
 *   3. Zero-decimal currency (JPY) → amount NOT divided/multiplied by 100
 *   4. Deterministic idempotency keys: paycraft:{tenant}:{product}:{suffix}
 *   5. Stale Stripe Product ID self-heal — clear DB, recreate, bump idempotency
 *      generation so Stripe's 24h idempotency cache doesn't return the orphan.
 *
 * The Stripe SDK and `getConnectedStripeClient` are mocked. Stripe call captures
 * (params + options) are inspected directly via the mock function call history.
 */

// ---- Mocks ---------------------------------------------------------------

interface FakePrice { id: string; product: string; currency: string; unit_amount: number; active: boolean }
interface FakeProduct { id: string; name: string; active: boolean; metadata: Record<string, string>; created: number }
interface FakePaymentLink { id: string; url: string; metadata: Record<string, string>; active: boolean }

const stripeProducts = {
  create: jest.fn<Promise<FakeProduct>, [any, any?]>(),
  retrieve: jest.fn<Promise<FakeProduct>, [string]>(),
  update: jest.fn<Promise<FakeProduct>, [string, any]>(),
  search: jest.fn<Promise<{ data: FakeProduct[] }>, [any]>(),
}
const stripePrices = {
  create: jest.fn<Promise<FakePrice>, [any, any?]>(),
  list: jest.fn<Promise<{ data: FakePrice[] }>, [any]>(),
}
const stripePaymentLinks = {
  create: jest.fn<Promise<FakePaymentLink>, [any, any?]>(),
  list: jest.fn<Promise<{ data: FakePaymentLink[] }>, [any]>(),
}

const fakeStripeClient = {
  products: stripeProducts,
  prices: stripePrices,
  paymentLinks: stripePaymentLinks,
}

jest.mock("@/lib/stripe-client", () => ({
  getConnectedStripeClient: jest.fn(async () => fakeStripeClient),
}))

// The lib's import resolves the `stripe` package only for its `Stripe` type;
// providing a noop default-export keeps `import type Stripe from "stripe"` cheap.
jest.mock("stripe", () => ({ __esModule: true, default: class FakeStripe {} }))

import { syncProductToStripe, toStripeInterval } from "../../lib/stripe-product-sync"

// ---- Helpers -------------------------------------------------------------

const TENANT = "tenant-abc"
const PRODUCT = "prod-uuid-123"
const NAME = "Pro Plan"

function resetMocks() {
  for (const fn of [
    stripeProducts.create, stripeProducts.retrieve, stripeProducts.update, stripeProducts.search,
    stripePrices.create, stripePrices.list,
    stripePaymentLinks.create, stripePaymentLinks.list,
  ]) {
    fn.mockReset()
  }
  // Default: no adoption hits, no existing payment links.
  stripeProducts.search.mockResolvedValue({ data: [] })
  stripePaymentLinks.list.mockResolvedValue({ data: [] })
  stripePrices.list.mockResolvedValue({ data: [] })
}

/** Make products.create reflect back the params so test asserts can read the name. */
function wireProductCreate(idemTracker?: Map<string, FakeProduct>) {
  stripeProducts.create.mockImplementation(async (params: any, opts: any) => {
    const key = opts?.idempotencyKey ?? `${params.name}:${Math.random()}`
    const existing = idemTracker?.get(key)
    if (existing) return existing
    const prod: FakeProduct = {
      id: `prod_${Math.random().toString(36).slice(2, 10)}`,
      name: params.name,
      active: true,
      metadata: params.metadata ?? {},
      created: Math.floor(Date.now() / 1000),
    }
    idemTracker?.set(key, prod)
    return prod
  })
}

/** Track price.create idempotency keys → returned object. */
function wirePriceCreate(idemTracker?: Map<string, FakePrice>) {
  stripePrices.create.mockImplementation(async (params: any, opts: any) => {
    const key = opts?.idempotencyKey ?? Math.random().toString()
    const existing = idemTracker?.get(key)
    if (existing) return existing
    const price: FakePrice = {
      id: `price_${Math.random().toString(36).slice(2, 10)}`,
      product: params.product,
      currency: params.currency,
      unit_amount: params.unit_amount,
      active: true,
    }
    idemTracker?.set(key, price)
    return price
  })
}

function wirePaymentLinkCreate(idemTracker?: Map<string, FakePaymentLink>) {
  stripePaymentLinks.create.mockImplementation(async (params: any, opts: any) => {
    const key = opts?.idempotencyKey ?? Math.random().toString()
    const existing = idemTracker?.get(key)
    if (existing) return existing
    const pl: FakePaymentLink = {
      id: `plink_${Math.random().toString(36).slice(2, 10)}`,
      url: `https://buy.stripe.com/${Math.random().toString(36).slice(2, 10)}`,
      metadata: params.metadata ?? {},
      active: true,
    }
    idemTracker?.set(key, pl)
    return pl
  })
}

beforeEach(() => {
  resetMocks()
  wireProductCreate()
  wirePriceCreate()
  wirePaymentLinkCreate()
})

// ---- Tests ---------------------------------------------------------------

describe("syncProductToStripe — single-currency", () => {
  it("creates 1 Product + 1 Price + 1 Payment Link for USD-only product", async () => {
    const result = await syncProductToStripe(
      TENANT,
      PRODUCT,
      NAME,
      "subscription",
      toStripeInterval("month"),
      [{ currency: "USD", amountCents: 999 }],
    )

    expect(stripeProducts.create).toHaveBeenCalledTimes(1)
    expect(stripePrices.create).toHaveBeenCalledTimes(1)
    expect(stripePaymentLinks.create).toHaveBeenCalledTimes(1)

    // Idempotency keys match the canonical format.
    expect(stripeProducts.create.mock.calls[0][1]).toEqual({
      idempotencyKey: `paycraft:${TENANT}:${PRODUCT}:product`,
    })
    expect(stripePrices.create.mock.calls[0][1]).toEqual({
      idempotencyKey: `paycraft:${TENANT}:${PRODUCT}:price-USD`,
    })
    expect(stripePaymentLinks.create.mock.calls[0][1]).toEqual({
      idempotencyKey: `paycraft:${TENANT}:${PRODUCT}:paymentlink-USD`,
    })

    // Price params include subscription recurring + lower-cased currency + cents as-is.
    const priceParams = stripePrices.create.mock.calls[0][0]
    expect(priceParams).toMatchObject({
      currency: "usd",
      unit_amount: 999,
      recurring: { interval: "month" },
    })

    expect(result.pricesByCurrency).toEqual({ USD: expect.stringMatching(/^price_/) })
    expect(result.paymentLinksByCurrency).toEqual({
      USD: expect.stringMatching(/^https:\/\/buy\.stripe\.com\//),
    })
  })
})

describe("syncProductToStripe — multi-currency", () => {
  it("creates 1 Product + 3 Prices + 3 Payment Links for USD/EUR/GBP", async () => {
    const result = await syncProductToStripe(
      TENANT,
      PRODUCT,
      NAME,
      "subscription",
      toStripeInterval("year"),
      [
        { currency: "USD", amountCents: 9900 },
        { currency: "EUR", amountCents: 8900 },
        { currency: "GBP", amountCents: 7900 },
      ],
    )

    expect(stripeProducts.create).toHaveBeenCalledTimes(1)
    expect(stripePrices.create).toHaveBeenCalledTimes(3)
    expect(stripePaymentLinks.create).toHaveBeenCalledTimes(3)

    // Each currency gets a deterministic idempotency key.
    const priceKeys = stripePrices.create.mock.calls.map((c) => c[1].idempotencyKey).sort()
    expect(priceKeys).toEqual([
      `paycraft:${TENANT}:${PRODUCT}:price-EUR`,
      `paycraft:${TENANT}:${PRODUCT}:price-GBP`,
      `paycraft:${TENANT}:${PRODUCT}:price-USD`,
    ])
    const linkKeys = stripePaymentLinks.create.mock.calls.map((c) => c[1].idempotencyKey).sort()
    expect(linkKeys).toEqual([
      `paycraft:${TENANT}:${PRODUCT}:paymentlink-EUR`,
      `paycraft:${TENANT}:${PRODUCT}:paymentlink-GBP`,
      `paycraft:${TENANT}:${PRODUCT}:paymentlink-USD`,
    ])

    expect(Object.keys(result.pricesByCurrency).sort()).toEqual(["EUR", "GBP", "USD"])
    expect(Object.keys(result.paymentLinksByCurrency).sort()).toEqual(["EUR", "GBP", "USD"])

    // Subscription "year" maps to recurring.interval = "year".
    for (const call of stripePrices.create.mock.calls) {
      expect(call[0]).toHaveProperty("recurring.interval", "year")
    }
  })
})

describe("syncProductToStripe — zero-decimal currencies", () => {
  it("passes JPY amount through unmodified (no *100 / /100)", async () => {
    await syncProductToStripe(
      TENANT,
      PRODUCT,
      NAME,
      "subscription",
      toStripeInterval("month"),
      [{ currency: "JPY", amountCents: 1100 }],
    )

    expect(stripePrices.create).toHaveBeenCalledTimes(1)
    const priceParams = stripePrices.create.mock.calls[0][0]
    expect(priceParams).toMatchObject({
      currency: "jpy",
      unit_amount: 1100, // NOT 110000, NOT 11
    })
  })

  it("passes non-zero-decimal currency through unmodified (no *100)", async () => {
    await syncProductToStripe(
      TENANT,
      PRODUCT,
      NAME,
      "subscription",
      toStripeInterval("month"),
      [{ currency: "USD", amountCents: 999 }],
    )

    const priceParams = stripePrices.create.mock.calls[0][0]
    expect(priceParams.unit_amount).toBe(999) // The lib stores as minor units already.
  })
})

describe("syncProductToStripe — idempotency", () => {
  it("re-calling with same inputs reuses existing Stripe objects via idempotency cache", async () => {
    // Wire shared idempotency trackers so a second invocation with the same
    // key returns the *same* object (mimics Stripe's 24h idempotency cache).
    const productCache = new Map<string, FakeProduct>()
    const priceCache = new Map<string, FakePrice>()
    const linkCache = new Map<string, FakePaymentLink>()
    wireProductCreate(productCache)
    wirePriceCreate(priceCache)
    wirePaymentLinkCreate(linkCache)

    const inputs: Parameters<typeof syncProductToStripe> = [
      TENANT,
      PRODUCT,
      NAME,
      "subscription",
      toStripeInterval("month"),
      [{ currency: "USD", amountCents: 999 }],
    ]
    const first = await syncProductToStripe(...inputs)
    const second = await syncProductToStripe(...inputs)

    expect(first.stripeProductId).toBe(second.stripeProductId)
    expect(first.pricesByCurrency.USD).toBe(second.pricesByCurrency.USD)
    expect(first.paymentLinksByCurrency.USD).toBe(second.paymentLinksByCurrency.USD)

    // Both calls used identical idempotency keys.
    expect(stripeProducts.create.mock.calls[0][1].idempotencyKey).toBe(
      stripeProducts.create.mock.calls[1][1].idempotencyKey,
    )
  })
})

describe("syncProductToStripe — stale ID self-heal", () => {
  it("clears DB IDs and recreates when Stripe returns resource_missing on saved product", async () => {
    // DB has prod_OLD + price_OLD_USD; Stripe says product is gone.
    const staleErr: any = new Error("No such product: 'prod_OLD'")
    staleErr.code = "resource_missing"
    stripeProducts.retrieve.mockRejectedValueOnce(staleErr)
    // After heal, product is re-created fresh.
    stripeProducts.create.mockImplementationOnce(async (params: any) => ({
      id: "prod_NEW",
      name: params.name,
      active: true,
      metadata: params.metadata ?? {},
      created: Math.floor(Date.now() / 1000),
    }))
    // New Price created post-heal.
    stripePrices.create.mockImplementationOnce(async (params: any) => ({
      id: "price_NEW_USD",
      product: params.product,
      currency: params.currency,
      unit_amount: params.unit_amount,
      active: true,
    }))
    wirePaymentLinkCreate()

    const result = await syncProductToStripe(
      TENANT,
      PRODUCT,
      NAME,
      "subscription",
      toStripeInterval("month"),
      [{ currency: "USD", amountCents: 999 }],
      { stripeProductId: "prod_OLD", existingPrices: { USD: "price_OLD_USD" } },
    )

    // The stale ID was tried first.
    expect(stripeProducts.retrieve).toHaveBeenCalledWith("prod_OLD")
    // Then a fresh product was created.
    expect(stripeProducts.create).toHaveBeenCalledTimes(1)
    expect(result.stripeProductId).toBe("prod_NEW")
    // The existing-price map was dropped — a new Price was created for USD.
    expect(stripePrices.create).toHaveBeenCalledTimes(1)
    expect(result.pricesByCurrency.USD).toBe("price_NEW_USD")

    // The heal-generation suffix was appended to the idempotency keys so the
    // recreate call cannot retrieve the orphan from Stripe's idem cache.
    const prodIdemKey = stripeProducts.create.mock.calls[0][1].idempotencyKey
    expect(prodIdemKey).toMatch(/^paycraft:tenant-abc:prod-uuid-123:product:heal-\d+$/)
    const priceIdemKey = stripePrices.create.mock.calls[0][1].idempotencyKey
    expect(priceIdemKey).toMatch(/^paycraft:tenant-abc:prod-uuid-123:price-USD:heal-\d+$/)
  })

  it("keeps stale ID when retrieve succeeds (no heal)", async () => {
    stripeProducts.retrieve.mockResolvedValueOnce({
      id: "prod_OLD",
      name: "old",
      active: true,
      metadata: {},
      created: 0,
    })
    stripeProducts.update.mockResolvedValueOnce({
      id: "prod_OLD", name: NAME, active: true, metadata: {}, created: 0,
    })

    const result = await syncProductToStripe(
      TENANT,
      PRODUCT,
      NAME,
      "subscription",
      toStripeInterval("month"),
      [{ currency: "USD", amountCents: 999 }],
      { stripeProductId: "prod_OLD", existingPrices: { USD: "price_OLD_USD" } },
    )

    expect(result.stripeProductId).toBe("prod_OLD")
    // Existing price reused — no new price.create call.
    expect(stripePrices.create).not.toHaveBeenCalled()
    expect(result.pricesByCurrency.USD).toBe("price_OLD_USD")
    // No products.create either.
    expect(stripeProducts.create).not.toHaveBeenCalled()
    // Drift recovery: name was pushed.
    expect(stripeProducts.update).toHaveBeenCalledWith("prod_OLD", { name: NAME })
  })
})
