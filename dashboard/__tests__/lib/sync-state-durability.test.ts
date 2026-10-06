/**
 * Regression: a product-sync run must never leave a row whose recorded state is
 * indistinguishable from a successful one.
 *
 * The incident (mbs/cappy, 2026-10-06). `runProductSync` opened with
 * `tenant_products_set_sync_state(p_status: "syncing", p_state: null)`, and migration 078's RPC
 * merges with `CASE WHEN p_state IS NULL THEN sync_state ELSE sync_state || p_state END` — so the
 * null PRESERVED the previous run's per-provider map. The route then died before its terminal
 * write (the drain client timed out at 90s while the server was still fanning out), leaving
 * `cappy_plus_guardian` stranded:
 *
 *     sync_status = 'syncing'            (14+ minutes, no process alive)
 *     sync_state  = {"stripe":{"status":"synced"}, …}   ← from 2026-09-23, read as fresh
 *     synced_at   = 2026-09-23
 *
 * A dead run that presents three-weeks-stale success is worse than either a failure or an empty
 * state: the operator (and an agent reading the row) concludes the providers finished.
 *
 * The second half of the same incident: all 7 products across cappy AND reels-downloader carried
 * `sync_state.stripe.status='synced'` while every `stripe_product_id` was unreadable with the
 * tenant's connected live key. A provider helper returning ok proves the write was accepted by the
 * client we hold — not that the object is retrievable afterwards.
 *
 * These assert on the SOURCE of `runProductSync`, following the precedent set by
 * `bulk-sync-classification.test.ts`: the function's failure modes live in control flow around five
 * provider helpers plus a Stripe client, and a mock deep enough to exercise them asserts the mock
 * rather than the contract. The contract is what must not regress.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { classifyProvider, type ProviderSyncEntry } from "@/lib/stripe-route-helper"

const SRC = readFileSync(join(process.cwd(), "lib/stripe-route-helper.ts"), "utf8")

/** Body of `runProductSync`, from its signature to the start of the next top-level declaration. */
function runProductSyncBody(): string {
  const start = SRC.indexOf("export async function runProductSync(")
  expect(start).toBeGreaterThan(-1)
  const after = SRC.indexOf("\n/**", start)
  return SRC.slice(start, after > -1 ? after : undefined)
}

describe("runProductSync — sync_state durability", () => {
  it("opens with a NON-NULL p_state so a dead run cannot present the previous run's success", () => {
    const body = runProductSyncBody()
    const opening = body.slice(0, body.indexOf('p_status: "syncing"') + 200)

    // The precise regression: `p_state: null` on the opening call.
    expect(opening).not.toMatch(/p_status:\s*"syncing",\s*\n?\s*p_state:\s*null/)
    expect(opening).toMatch(/p_state:\s*inFlight/)
  })

  it("marks exactly the providers THIS run touches as in-flight, leaving the rest merged", () => {
    const body = runProductSyncBody()
    // Built from `keys` (which honours onlyProvider), never from the full runner set — a
    // single-provider retry must not wipe the other providers' recorded state, which is the whole
    // reason 078's RPC merges.
    expect(body).toMatch(/const inFlight = Object\.fromEntries\(\s*\n?\s*keys\.map\(/)
  })

  it("writes a terminal state when the provider fan-out THROWS, instead of leaving 'syncing'", () => {
    const body = runProductSyncBody()
    expect(body).toMatch(/catch\s*\(e: any\)\s*\{/)
    // The catch must both record failure and rethrow — swallowing would report a clean run.
    const caught = body.slice(body.indexOf("catch (e: any)"))
    expect(caught).toMatch(/p_status:\s*"failed"/)
    expect(caught).toMatch(/throw e/)
  })

  it("READS BACK the stripe product before letting 'synced' stand", () => {
    const body = runProductSyncBody()
    expect(body).toMatch(/providers\.stripe\?\.status === "synced"/)
    expect(body).toMatch(/verifyStripeProduct\(/)

    // The readback must be able to DOWNGRADE the entry, not merely log.
    const verify = SRC.slice(SRC.indexOf("async function verifyStripeProduct("))
    expect(verify).toMatch(/products\.retrieve\(/)
    expect(verify).toMatch(/status: "failed"/)
    // It must keep the provider's error message: a bare `catch {}` collapses "deleted",
    // "wrong account" and "revoked key" into one unreadable, which is what made the
    // cappy/reels failure undiagnosable from drift output alone.
    expect(verify).toMatch(/e\?\.message/)
  })

  it("never rolls an in-flight provider up to 'synced'", () => {
    const body = runProductSyncBody()
    // `syncing` is non-terminal, so a leftover in-flight entry must degrade the rollup.
    expect(body).toMatch(/v\.status === "draft" \|\| v\.status === "syncing"/)
  })
})

describe("ProviderSyncEntry — 'syncing' is a first-class non-terminal status", () => {
  it("classifyProvider still never INVENTS a syncing entry", () => {
    // The in-flight marker is written by runProductSync only. The classifier maps real provider
    // results, so it must keep returning terminal statuses.
    const cases: Array<Parameters<typeof classifyProvider>[0]> = [
      undefined,
      { skipped: true, reason: "Stripe is not connected" },
      { error: "not connected" },
      { error: "boom" },
      { warning: "offer DRAFT until published" },
      { ok: true },
    ]
    const got = cases.map((c) => classifyProvider(c).status)
    expect(got).not.toContain("syncing")
  })

  it("admits 'syncing' in the type so the marker needs no cast", () => {
    const entry: ProviderSyncEntry = { status: "syncing", reason: "sync in progress" }
    expect(entry.status).toBe("syncing")
  })
})
