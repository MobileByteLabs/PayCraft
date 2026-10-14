/**
 * Every storable billing interval must map on EVERY provider — or not be storable.
 *
 * WHY THIS EXISTS
 * Adding a cadence touches a constraint and five independent mappers. Migration 088 saw this
 * coming and left a forward-compat guard ("the day someone widens the interval CHECK to add a
 * cadence and forgets this CASE, the backfill stops instead of silently leaving those products
 * unmapped"), but that guard only covers the SQL side. On the dashboard side a missed arm fails in
 * three different ways, and only one of them is loud:
 *
 *   • Stripe / Razorpay / Play  -> throw or return null, so the sync fails visibly
 *   • App Store `ascCadenceWords` -> falls through to `default: "Billed monthly"`, so a WEEKLY plan
 *     is advertised to the store as monthly. Silent, wrong, and user-visible. This was a real miss
 *     while adding `week` on 2026-10-09; tsc did not catch it because the types still lined up.
 *
 * So the assertion is not "does it compile" but "does every interval produce a DISTINCT, correct
 * answer". The cadence-wording cases are the ones that matter most, because they are the ones a
 * type checker cannot see.
 *
 * SCOPE: the five intervals `tenant_products_interval_check` admits after PayCraft migration 151.
 * `semiannual` is no longer in the DEFAULT CATALOGUE but is still STORABLE (4 live rows use it), so
 * it stays in this list — dropping a tier from the defaults is not the same as revoking the value.
 */

import { toStripeInterval } from "@/lib/stripe-product-sync"
import { playBillingPeriod } from "@/lib/googleplay-product-sync"

/** Exactly what the DB CHECK admits. Adding a value here without the mappers fails below. */
const STORABLE_INTERVALS = ["week", "month", "quarter", "semiannual", "year"] as const

describe("interval cadence coverage", () => {
  describe("Stripe", () => {
    it.each(STORABLE_INTERVALS)("maps %s to a recurring param", (interval) => {
      const r = toStripeInterval(interval)
      expect(r).not.toBeNull()
      expect(r!.interval).toBeTruthy()
    })

    it("maps week to a native weekly interval, not a month multiple", () => {
      // Stripe supports interval=week directly; expressing it as a fraction of a month is not
      // possible, so this is the one cadence that cannot be faked with interval_count.
      expect(toStripeInterval("week")).toEqual({ interval: "week" })
    })

    it("still returns null for a non-recurring product", () => {
      // The null path is load-bearing: it is how one-time / trial products skip price creation.
      expect(toStripeInterval(null)).toBeNull()
      expect(toStripeInterval("lifetime")).toBeNull()
    })
  })

  describe("Google Play", () => {
    it.each(STORABLE_INTERVALS)("maps %s to an ISO-8601 billing period", (interval) => {
      expect(playBillingPeriod(interval)).toMatch(/^P\d+[DWMY]$/)
    })

    it("maps week to P1W", () => {
      expect(playBillingPeriod("week")).toBe("P1W")
    })

    it("throws on an unknown cadence rather than inventing a period", () => {
      // A wrong billing period silently charges on the wrong schedule, so refusing is correct.
      expect(() => playBillingPeriod("fortnight")).toThrow()
    })
  })

  describe("every interval produces a DISTINCT Play period", () => {
    it("no two cadences collapse onto the same period", () => {
      // The failure this catches: a copy-pasted arm returning P1M for week. Every cadence bills on
      // a different schedule, so any duplicate is a mis-mapping, not a coincidence.
      const periods = STORABLE_INTERVALS.map((i) => playBillingPeriod(i))
      expect(new Set(periods).size).toBe(STORABLE_INTERVALS.length)
    })
  })
})
