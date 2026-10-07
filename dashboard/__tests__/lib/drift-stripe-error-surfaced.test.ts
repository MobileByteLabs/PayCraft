/**
 * A "not readable at Stripe" finding must carry the REASON Stripe gave.
 *
 * WHY THIS TEST EXISTS
 * The readback was `try { products.retrieve(id) } catch { push("not readable at Stripe") }`. A bare
 * `catch {}` collapses three different root causes with three different remedies into one string:
 *
 *   resource_missing      → the id is absent from the CONNECTED account (deleted, or created under
 *                           a different account than the key now stored) — re-sync creates it
 *   authentication_error  → the key is revoked/rotated — re-syncing cannot help, fix the credential
 *   a network fault       → nothing is wrong with the data at all
 *
 * Measured 2026-10-06: all 7 products across tenants cappy and reels-downloader reported
 * "not readable at Stripe" and the output contained NOTHING to act on. Two hours of diagnosis went
 * into questions the discarded exception would have answered in one line.
 *
 * Also asserted: the `no-test-credential` detail must not emit a key VALUE. That `detail` is
 * returned by /api/sync/drift and lands in logs, CI output and agent transcripts — one did leak a
 * live publishable key into a transcript on 2026-10-06. Publishable keys are low-tier, but the same
 * string shape is reused for providers whose `key_id` is not publishable.
 */

import { detectNoTestCredential, detectProductMissingAtProvider } from "@/lib/drift-detectors"

const TENANT = "ba973ad0-8788-4c0f-89c8-1ff9533fa79f"

const retrieve = jest.fn()
jest.mock("@/lib/stripe-client", () => ({
  getConnectedStripeClient: jest.fn(async () => ({ products: { retrieve: (id: string) => retrieve(id) } })),
}))

/** `.select().eq().eq()` chainable AND awaitable — only what the detectors use. */
function fakeSupabase(rows: unknown[]) {
  const thenable: Record<string, unknown> = {
    select: () => thenable,
    eq: () => thenable,
    then: (res: (v: { data: unknown[] | null; error: unknown }) => unknown) =>
      res({ data: rows, error: null }),
  }
  return { from: () => thenable } as never
}

const product = {
  id: "47ddeaf3-eecb-4903-a998-96c630c80b17",
  sku: "cappy_plus_monthly",
  stripe_product_id: "prod_VJMNS10q3sZyzF",
  package_id: null,
}

beforeEach(() => retrieve.mockReset())

describe("detectProductMissingAtProvider — the Stripe reason survives", () => {
  it("names resource_missing AND points at the account mismatch, not just 'not readable'", async () => {
    const err: any = new Error("No such product: 'prod_VJMNS10q3sZyzF'")
    err.code = "resource_missing"
    retrieve.mockRejectedValue(err)

    const [f] = await detectProductMissingAtProvider(fakeSupabase([product]), TENANT)
    expect(f.detail).toContain("not readable at Stripe")
    expect(f.detail).toContain("[resource_missing]")
    expect(f.detail).toContain("No such product")
    // The remedy differs per cause, so the hint must too.
    expect(f.action_hint).toMatch(/different account|deleted/i)
  })

  it("surfaces an authentication failure as itself — re-syncing would not fix it", async () => {
    const err: any = new Error("Invalid API Key provided: sk_live_***")
    err.type = "authentication_error"
    retrieve.mockRejectedValue(err)

    const [f] = await detectProductMissingAtProvider(fakeSupabase([product]), TENANT)
    expect(f.detail).toContain("[authentication_error]")
    expect(f.detail).toContain("Invalid API Key")
  })

  it("still reports a bare failure with no code, rather than throwing", async () => {
    retrieve.mockRejectedValue(new Error("socket hang up"))
    const [f] = await detectProductMissingAtProvider(fakeSupabase([product]), TENANT)
    expect(f.detail).toContain("socket hang up")
    expect(f.kind).toBe("product-missing-at-provider")
  })

  it("reports nothing when the product IS readable and active", async () => {
    retrieve.mockResolvedValue({ id: product.stripe_product_id, active: true })
    expect(await detectProductMissingAtProvider(fakeSupabase([product]), TENANT)).toHaveLength(0)
  })
})

describe("detectNoTestCredential — never emits a key value", () => {
  it("masks the live key to its last 6 characters", async () => {
    const rows = [
      {
        provider: "stripe",
        is_active: true,
        // Deliberately SHORT + obviously synthetic: a >=20-char body matches the SV32
        // staged-secret guard (pk_(live|test)_[A-Za-z0-9]{20,}) and a real key's prefix has no
        // business in a committed fixture.
        live_key_id: "pk_live_FIXTUREaVcn",
        test_key_id: null,
        test_payment_links: {},
        provider_accounts: { config: {} },
      },
    ]
    const [f] = await detectNoTestCredential(fakeSupabase(rows), TENANT)
    expect(f).toBeDefined()
    // The whole key must not appear anywhere in the finding.
    const blob = JSON.stringify(f)
    expect(blob).not.toContain("pk_live_FIXTUREaVcn")
    expect(blob).not.toContain("FIXTURE")
    // Identity is still legible so an operator can tell WHICH key it means.
    expect(f.detail).toContain("REaVcn")   // slice(-6) of the fixture
  })
})
