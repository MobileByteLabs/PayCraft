import fs from "fs"
import path from "path"

/**
 * Razorpay plan ids are MODE-SCOPED (migration 141).
 *
 * Before it, `razorpay_plan_id_by_currency` was a single column written by whichever sync mode ran
 * last. `runProductSync` syncs every configured mode in one pass — live, then test — and recorded
 * "the last successful sync's ids", so a routine sync ended with a TEST plan id in the field the
 * LIVE checkout reads. A real customer could be handed a test-mode plan; Razorpay rejects it, and it
 * presents as a payment failure rather than the data bug it is.
 *
 * These are source-level assertions because the defect is about WHICH FIELD each path touches, and
 * a mocked unit test of either path passes whether or not the other one agrees.
 */

const ROOT = path.join(__dirname, "..", "..")
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8")

describe("checkout reads the plan map for the mode it is transacting in", () => {
  const src = read("lib/checkout-initiator.ts")

  it("selects the map by mode rather than reading one column unconditionally", () => {
    expect(src).toMatch(/mode === "test"[\s\S]{0,120}razorpay_plan_id_by_currency_test/)
  })

  it("never reads the live column without a mode check on the same expression", () => {
    // The pre-141 line was `req.product.razorpay_plan_id_by_currency?.["INR"]` — a direct read with
    // no mode anywhere near it. That exact shape must not come back.
    expect(src).not.toMatch(/const planId = req\.product\.razorpay_plan_id_by_currency\?\./)
  })

  it("does not fall back to the other mode when its own is missing", () => {
    // A `?? razorpay_plan_id_by_currency` fallback would silently bill a test checkout against a
    // live plan — worse than the error it is trying to avoid.
    expect(src).not.toMatch(/razorpay_plan_id_by_currency_test\s*\?\?\s*[\w.]*razorpay_plan_id_by_currency\b/)
    expect(src).not.toMatch(/razorpay_plan_id_by_currency\s*\?\?\s*[\w.]*razorpay_plan_id_by_currency_test\b/)
  })

  it("names the mode in the not-synced error", () => {
    expect(src).toMatch(/Razorpay \$\{mode\} plan not yet synced/)
  })
})

describe("the sync writes each mode to its own column", () => {
  const src = read("lib/stripe-route-helper.ts")

  it("passes p_mode to the setter", () => {
    expect(src).toMatch(/tenant_products_set_razorpay_ids[\s\S]{0,220}p_mode:/)
  })

  it("does not record ids from `lastResult`, which is whichever mode ran last", () => {
    expect(src).not.toMatch(/p_razorpay_plan_id_by_currency:\s*lastResult\.planIdsByCurrency/)
  })

  it("keeps per-mode results apart", () => {
    expect(src).toMatch(/rzResultsByMode/)
  })

  it("seeds a test sync from the TEST existing-ids map", () => {
    // Handing a test sync the live map makes it "reuse" a live plan id and register it as test.
    expect(src).toMatch(/mode === "test" \? existingRazorpayPlanIdsTest : existingRazorpayPlanIds/)
  })
})

describe("every caller supplies both maps", () => {
  // Enumerated from disk: a caller that passes only the live map silently reverts the fix for
  // whatever path it serves, and it would not fail any other test here.
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".next") continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p, out)
      else if (e.name.endsWith(".ts")) out.push(p)
    }
    return out
  }

  const callers = [...walk(path.join(ROOT, "lib")), ...walk(path.join(ROOT, "app"))]
    .map((f) => ({ rel: path.relative(ROOT, f), src: fs.readFileSync(f, "utf8") }))
    .filter((f) => f.src.includes("existingRazorpayPlanIds:"))

  it("finds the call sites (an empty sweep would pass everything below)", () => {
    expect(callers.length).toBeGreaterThanOrEqual(5)
  })

  it.each(callers.map((c) => [c.rel, c]))("%s also passes the test map", (_r, c: any) => {
    expect(c.src).toMatch(/existingRazorpayPlanIdsTest:/)
  })
})

describe("migration 141", () => {
  const sql = fs.readFileSync(
    path.join(ROOT, "..", "supabase", "migrations", "141_razorpay_plan_ids_mode_scoped.sql"),
    "utf8",
  )

  it("drops the two-argument setter instead of leaving it as an overload", () => {
    // Left in place, PostgREST would resolve an un-updated two-arg caller to it silently, and that
    // caller would keep writing the live column from a test sync — the exact defect being fixed.
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.tenant_products_set_razorpay_ids\(uuid, jsonb\)/)
  })

  it("refuses an unrecognised mode rather than defaulting to live", () => {
    expect(sql).toMatch(/invalid_mode/)
    expect(sql).not.toMatch(/p_mode\s+TEXT\s+DEFAULT/)
  })

  it("marks legacy live ids unverified rather than trusting them", () => {
    expect(sql).toMatch(/live_plan_ids_verified/)
  })
})
