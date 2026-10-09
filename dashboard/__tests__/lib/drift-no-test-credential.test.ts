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

/**
 * `.select().eq()` is chainable AND awaitable, plus `.rpc()`.
 *
 * `resolved` models what `tenant_providers_status` returns — the SECURITY DEFINER resolver the
 * detector now asks instead of embedding `provider_accounts(config)`. The embed is RLS-blocked
 * (service_role only) under the owner cookie session every caller uses, so it came back empty and
 * the detector fell through to the tenant row's NULL `test_key_id` — inventing a "NO test key"
 * finding for an account-attached app whose account had one. Passing `resolved: null` reproduces
 * "no row" (inactive/unattached), which must behave exactly as before.
 */
function fakeSupabase(
  rows: unknown[] | { error: true },
  resolved: { test_key_id: string | null; live_key_id: string | null } | null = null,
) {
  const thenable: Record<string, unknown> = {
    select: () => thenable,
    eq: () => thenable,
    then: (res: (v: { data: unknown[] | null; error: unknown }) => unknown) =>
      res("error" in (rows as object)
        ? { data: null, error: { message: "boom" } }
        : { data: rows as unknown[], error: null }),
  }
  return {
    from: () => thenable,
    rpc: async () => ({ data: resolved, error: null }),
  } as never
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
    // IDENTIFIES the offending value — a finding you cannot confirm is noise. It used to quote the
    // key in full; it is now masked to the last 6 characters, which keeps the finding confirmable
    // while keeping a credential out of an API response.
    //
    // The narrowing is deliberate, and this fixture is the reason: `key_id` is not always
    // publishable. `sk_live_abc` here is SECRET tier, and this `detail` is returned by
    // /api/sync/drift — it reaches logs, CI output and agent transcripts. One such detail leaked a
    // live publishable key into a transcript on 2026-10-06; the same code path would have leaked a
    // secret one for a provider whose key_id looks like this fixture.
    expect(out[0].detail).toContain("ve_abc")
    expect(out[0].detail).not.toContain("sk_live_abc")
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

/**
 * Regression (mbs/cappy, 2026-10-09): an ACCOUNT-ATTACHED app must not be reported as missing a
 * test key when the ACCOUNT holds one.
 *
 * cappy's stripe row is attached to account "mbs org stripe" (4 apps), whose config carries both
 * `live_key_id` and `test_key_id`. The tenant row's own key columns are NULL by design for such an
 * app, and `provider_accounts` has a single RLS policy (service_role) — so the detector's embed
 * returned nothing, the `?? r.test_key_id` fallback hit NULL, and `/idea-paycraft` reported a
 * credential gap on every run for a connection that could already transact in test mode.
 *
 * This is the class migration 132 fixed for `tenant_providers_status`; the detector simply did not
 * use it. The heal was to ask that resolver, NOT to widen RLS so the embed would work — widening
 * would expose a config blob to every tenant admin to satisfy a read the resolver already answers
 * behind its own `tenant_admins` check.
 */
describe("detectNoTestCredential — account-attached resolution", () => {
  it("stays SILENT when the attached ACCOUNT holds the test key and the tenant row is NULL", async () => {
    const out = await detectNoTestCredential(
      // Tenant row exactly as cappy's: both key columns NULL.
      fakeSupabase([stripe({ live_key_id: null, test_key_id: null })]),
      TENANT,
      // What tenant_providers_status resolves from the account.
      )
    // Sanity: with no resolver row this is the class-4 case, not a test-credential finding.
    expect(out.filter((f) => f.kind === "no-test-credential")).toHaveLength(0)
  })

  it("stays silent when the resolver reports BOTH modes from the account", async () => {
    const out = await detectNoTestCredential(
      fakeSupabase([stripe({ live_key_id: null, test_key_id: null })], {
        live_key_id: "pk_live_xxxxxxPPaVcn",
        test_key_id: "pk_test_yyyyyyyyyyyy",
      }),
      TENANT,
    )
    expect(out).toHaveLength(0)
  })

  it("STILL fires when the resolver confirms the account has live only", async () => {
    // The detector must not be defanged by the fix — a genuine gap still reports.
    const out = await detectNoTestCredential(
      fakeSupabase([stripe({ live_key_id: null, test_key_id: null })], {
        live_key_id: "pk_live_xxxxxxPPaVcn",
        test_key_id: null,
      }),
      TENANT,
    )
    expect(out).toHaveLength(1)
    expect(out[0].kind).toBe("no-test-credential")
    expect(out[0].detail).toContain("PPaVcn")
  })
})
