/**
 * An ACTIVE provider the resolver cannot get a credential for must be reported as "connect it",
 * not "sync it" — and an account-attached provider must NOT be reported at all.
 *
 * WHY THIS TEST EXISTS
 * `detectCredentialModeMismatch` had two branches and both required `live_key_id` to be PRESENT, so
 * a provider switched on and never connected matched neither and fell through to
 * `detectActiveProviderZeroLinks`, surfacing as "no payment links" with the hint
 * "Sync products to <provider> (POST /api/sync/all)". That sync can never clear it: with no
 * credential the drain returns `skipped — <provider> is not connected for this tenant` for every
 * product. drift-detectors.ts already names this failure mode — "a finding no action can clear
 * trains the operator to ignore the banner" — and Class 1 already defers the no-credential case
 * ("No live credential is Class 3's finding, not this one"). Nothing implemented the target.
 *
 * THE SECOND HALF IS THE DANGEROUS ONE. The first fix asked the COLUMNS (`live_key_id`,
 * `store_credential_enc`), which is wrong: a credential belongs to the ACCOUNT, so an
 * account-attached app has every key column NULL while billing live. On production tenant cappy
 * (2026-09-20) razorpay, app_store and google_play all resolve through accounts — that version
 * would have reported three healthy providers as broken. Migration 115 exists for exactly this
 * false negative ("two truths on one screen"). So connectivity comes from
 * `tenant_providers_resolved_list`, the same resolver the dashboard uses.
 */

import {
  detectActiveProviderZeroLinks,
  detectCredentialModeMismatch,
} from "@/lib/drift-detectors"

const TENANT = "ba973ad0-8788-4c0f-89c8-1ff9533fa79f"

/** `.select().eq().eq()` is chainable AND awaitable; `.rpc()` is awaitable. Only what is used. */
function fakeSupabase(
  tables: Record<string, unknown[]>,
  resolved: { provider: string; connected: boolean }[] | { error: true },
) {
  const make = (table: string) => {
    const thenable: Record<string, unknown> = {
      select: () => thenable,
      eq: () => thenable,
      then: (res: (v: { data: unknown[] }) => unknown) => res({ data: tables[table] ?? [] }),
    }
    return thenable
  }
  return {
    from: (table: string) => make(table),
    rpc: async () =>
      "error" in resolved ? { data: null, error: { message: "boom" } } : { data: resolved, error: null },
  } as never
}

/** razorpay: switched on, never connected — no local key AND no account. */
const UNCONNECTED = {
  provider: "razorpay",
  is_active: true,
  live_key_id: null,
  test_key_id: null,
  live_webhook_secret_enc: null,
  store_credential_enc: null,
  live_payment_links: null,
  test_payment_links: null,
}

const PRODUCTS = [
  { sku: "cappy_plus_monthly", type: "subscription", stripe_product_id: null, razorpay_plan_id_by_currency: {} },
]

describe("active provider with no resolvable credential", () => {
  it("is reported by Class 3, with a hint that says CONNECT", async () => {
    const out = await detectCredentialModeMismatch(
      fakeSupabase({ tenant_providers: [UNCONNECTED] }, [{ provider: "razorpay", connected: false }]),
      TENANT,
    )
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe("active-provider-no-credential")
    expect(out[0].action_hint).toMatch(/Connect razorpay/i)
    // The remedy must NOT be the sync that cannot work.
    expect(out[0].action_hint).not.toMatch(/sync/i)
  })

  it("is NOT also reported by Class 5 — one root cause, one finding", async () => {
    const out = await detectActiveProviderZeroLinks(
      fakeSupabase({ tenant_providers: [UNCONNECTED], tenant_products: PRODUCTS },
                   [{ provider: "razorpay", connected: false }]),
      TENANT,
    )
    expect(out).toHaveLength(0)
  })
})

describe("account-attached provider (every key column NULL)", () => {
  // The cappy shape: credential lives on provider_accounts, resolver says connected.
  const ATTACHED = { ...UNCONNECTED }

  it("is NOT reported as uncredentialed", async () => {
    const out = await detectCredentialModeMismatch(
      fakeSupabase({ tenant_providers: [ATTACHED] }, [{ provider: "razorpay", connected: true }]),
      TENANT,
    )
    expect(out).toHaveLength(0)
  })

  it("still gets the zero-links finding, since it CAN be synced", async () => {
    const out = await detectActiveProviderZeroLinks(
      fakeSupabase({ tenant_providers: [ATTACHED], tenant_products: PRODUCTS },
                   [{ provider: "razorpay", connected: true }]),
      TENANT,
    )
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe("active-provider-zero-links")
  })
})

describe("when the resolver itself cannot be read", () => {
  it("invents no finding — an outage must not become a 'connect your provider' banner", async () => {
    const out = await detectCredentialModeMismatch(
      fakeSupabase({ tenant_providers: [UNCONNECTED] }, { error: true }),
      TENANT,
    )
    expect(out).toHaveLength(0)
  })
})
