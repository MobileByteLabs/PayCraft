import { detectTestLinksMissing, DRIFT_DETECTORS, DRIFT_KINDS } from "@/lib/drift-detectors"

/**
 * Class 8 — a test credential and live links, but no test links.
 *
 * This is the state that blocked Stripe test mode on cappy while every existing detector stayed
 * quiet: `detectActiveProviderZeroLinks` sums both modes and returned early on the live links, and
 * `detectNoTestCredential` requires the credential to be ABSENT. The gap sat exactly between them.
 */

const TENANT = "11111111-1111-1111-1111-111111111111"

/** Minimal stub of the PostgREST chain this detector uses. */
function supa(rows: unknown[] | null, error: unknown = null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => Promise.resolve({ data: rows, error }),
      }),
    }),
  } as never
}

const links = (n: number) =>
  n === 0 ? {} : { sku1: Object.fromEntries(Array.from({ length: n }, (_, i) => [`cur${i}`, `l${i}`])) }

describe("detectTestLinksMissing", () => {
  it("fires when a test credential exists, live links exist, and test links do not", async () => {
    const out = await detectTestLinksMissing(
      supa([
        {
          provider: "stripe",
          is_active: true,
          live_payment_links: links(3),
          test_payment_links: links(0),
          test_key_id: null,
          provider_accounts: { config: { test_key_id: "pk_test_x", live_key_id: "pk_live_x" } },
        },
      ]),
      TENANT,
    )
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe("test-links-missing")
    expect(out[0].subject).toBe("provider:stripe")
    expect(out[0].subject_id).toBe("stripe")
  })

  it("reads the test credential from the shared ACCOUNT, not the per-app column", async () => {
    // The per-app column has been unwritten since migration 112. If this detector only trusted it,
    // it would never fire for any app onboarded through the account tier — the same bug it exists
    // to report.
    const out = await detectTestLinksMissing(
      supa([
        {
          provider: "stripe",
          is_active: true,
          live_payment_links: links(2),
          test_payment_links: links(0),
          test_key_id: null,
          provider_accounts: [{ config: { test_key_id: "pk_test_from_account" } }],
        },
      ]),
      TENANT,
    )
    expect(out).toHaveLength(1)
  })

  it("stays quiet when test links already exist", async () => {
    const out = await detectTestLinksMissing(
      supa([
        {
          provider: "stripe",
          is_active: true,
          live_payment_links: links(3),
          test_payment_links: links(1),
          test_key_id: "pk_test_x",
          provider_accounts: null,
        },
      ]),
      TENANT,
    )
    expect(out).toEqual([])
  })

  it("defers to class 7 when there is no test credential at all", async () => {
    const out = await detectTestLinksMissing(
      supa([
        {
          provider: "razorpay",
          is_active: true,
          live_payment_links: links(2),
          test_payment_links: links(0),
          test_key_id: null,
          provider_accounts: { config: { live_key_id: "rzp_live_x" } },
        },
      ]),
      TENANT,
    )
    expect(out).toEqual([])
  })

  it("defers to class 6 when nothing is synced in either mode", async () => {
    const out = await detectTestLinksMissing(
      supa([
        {
          provider: "stripe",
          is_active: true,
          live_payment_links: links(0),
          test_payment_links: links(0),
          test_key_id: "pk_test_x",
          provider_accounts: null,
        },
      ]),
      TENANT,
    )
    expect(out).toEqual([])
  })

  it("ignores store providers, whose test mode is a sandbox purchase and not a link", async () => {
    for (const provider of ["google_play", "app_store"]) {
      const out = await detectTestLinksMissing(
        supa([
          {
            provider,
            is_active: true,
            live_payment_links: links(2),
            test_payment_links: links(0),
            test_key_id: "whatever",
            provider_accounts: null,
          },
        ]),
        TENANT,
      )
      expect(out).toEqual([])
    }
  })

  it("stays quiet on an unreadable table rather than inventing a finding", async () => {
    expect(await detectTestLinksMissing(supa(null, { message: "boom" }), TENANT)).toEqual([])
  })

  it("is registered, so the drift report actually runs it", () => {
    expect(DRIFT_DETECTORS).toContain(detectTestLinksMissing)
    expect(DRIFT_KINDS).toContain("test-links-missing")
  })
})

describe("the blind spot this closes", () => {
  it("is invisible to a both-modes-summed link count", () => {
    // Documents WHY class 6 misses it: 3 live + 0 test is a non-zero total, so its early return
    // fires and the mode asymmetry never surfaces.
    const live = 3
    const test = 0
    expect(live + test).toBeGreaterThan(0) // class 6 returns early here…
    expect(test).toBe(0) // …while the state that blocks test mode is right there
  })
})
