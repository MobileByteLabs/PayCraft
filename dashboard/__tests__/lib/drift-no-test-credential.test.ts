/**
 * A provider that can only ever transact LIVE must say so, because nothing else does.
 *
 * WHY THIS TEST EXISTS
 * `runProductSync` syncs into every CONFIGURED mode ("Sync into EVERY configured mode, not just the
 * preferred one"), so a tenant holding only a live key gets live products and SILENCE — the sync
 * reports success, every product reads `synced`, and `test_payment_links` stays `{}`. Measured on
 * production tenant cappy 2026-09-22, straight out of `/config`:
 *
 *     "test_payment_links": {},
 *     "live_payment_links": { "cappy_plus_annual": { "USD": "https://buy.stripe.com/…" }, … }
 *
 * A debug build resolves the empty map and the checkout button does nothing — the same
 * dead-button failure `stripe-route-helper.ts` describes. The developer's realistic options were to
 * give up on testing or to point a debug build at live and pay real money. Neither is visible from
 * the dashboard, which is what makes this a finding rather than a preference.
 *
 * THE INVERSE MATTERS TOO. This must NOT fire when both modes are present (nothing to fix) or when
 * there is no credential at all — that belongs to `active-provider-no-credential`, whose remedy is
 * "connect it", not "add a test key". Reporting one root cause from two rows is exactly what
 * drift-detectors.ts warns against.
 */

import { detectNoTestCredential } from "@/lib/drift-detectors"

const TENANT = "ba973ad0-8788-4c0f-89c8-1ff9533fa79f"

/** `.select().eq()` is chainable AND awaitable. Only what the detector uses. */
function fakeSupabase(rows: unknown[] | { error: true }) {
  const thenable: Record<string, unknown> = {
    select: () => thenable,
    eq: () => thenable,
    then: (res: (v: { data: unknown[] | null; error: unknown }) => unknown) =>
      res("error" in (rows as object)
        ? { data: null, error: { message: "boom" } }
        : { data: rows as unknown[], error: null }),
  }
  return { from: () => thenable } as never
}

const stripe = (over: Record<string, unknown> = {}) => ({
  provider: "stripe",
  is_active: true,
  live_key_id: "sk_live_abc",
  test_key_id: null,
  test_payment_links: {},
  ...over,
})

describe("detectNoTestCredential", () => {
  it("fires when a live key exists and no test key does", async () => {
    const out = await detectNoTestCredential(fakeSupabase([stripe()]), TENANT)
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe("no-test-credential")
    expect(out[0].subject).toBe("provider:stripe")
    // QUOTES the offending value — a finding you cannot confirm is noise.
    expect(out[0].detail).toContain("sk_live_abc")
    // And names a concrete next action, not a description of the problem.
    expect(out[0].action_hint).toMatch(/TEST-mode key/i)
    expect(out[0].subject_id).toBe("stripe")
  })

  it("stays silent when BOTH modes are configured", async () => {
    const out = await detectNoTestCredential(
      fakeSupabase([stripe({ test_key_id: "sk_test_xyz" })]),
      TENANT,
    )
    expect(out).toHaveLength(0)
  })

  it("defers to active-provider-no-credential when there is no credential at all", async () => {
    const out = await detectNoTestCredential(
      fakeSupabase([stripe({ live_key_id: null, test_key_id: null })]),
      TENANT,
    )
    expect(out).toHaveLength(0)
  })

  it("still fires for an INACTIVE provider — that is when the fix is cheapest", async () => {
    const out = await detectNoTestCredential(fakeSupabase([stripe({ is_active: false })]), TENANT)
    expect(out).toHaveLength(1)
    expect(out[0].detail).toContain("inactive")
  })

  it("reports nothing when the table is unreadable — an outage is not a finding", async () => {
    const out = await detectNoTestCredential(fakeSupabase({ error: true }), TENANT)
    expect(out).toHaveLength(0)
  })
})
