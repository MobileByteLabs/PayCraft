import fs from "fs"
import path from "path"

/**
 * Stripe product + price ids are MODE-SCOPED (migration 147). This is the sibling of
 * `razorpay-plan-mode-scope.test.ts`; same defect, same shape, one provider later.
 *
 * Before it, `stripe_product_id` / `stripe_price_id_by_currency` were single columns written by
 * whichever sync mode ran last. `stripeSyncProduct` builds `modes` live-first and recorded
 * `lastResult` — the LAST iteration, i.e. TEST — so a routine sync on a both-keys tenant ended with
 * test product and price ids in the fields LIVE checkout reads.
 *
 * MEASURED 2026-10-06, tenants cappy + reels-downloader, 7 products, from Stripe itself:
 *
 *     No such product: 'prod_VJMNS10q3sZyzF'; a similar object exists in test mode,
 *     but a live mode key was used to make this request
 *
 * Live Stripe checkout on two shipped apps was pointed at test-mode objects.
 *
 * Source-level assertions, for the reason the Razorpay sibling gives: the defect is about WHICH
 * FIELD each path touches, and a mocked unit test of either path passes whether or not the other
 * agrees.
 */

const ROOT = path.join(__dirname, "..", "..")
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), "utf8")

describe("the sync writes each mode to its own columns", () => {
  const src = read("lib/stripe-route-helper.ts")

  it("passes p_mode to the setter", () => {
    expect(src).toMatch(/tenant_products_set_stripe_ids[\s\S]{0,260}p_mode:/)
  })

  it("does not record ids from `lastResult`, which is whichever mode ran last", () => {
    expect(src).not.toMatch(/p_stripe_product_id:\s*lastResult\.stripeProductId/)
    expect(src).not.toMatch(/p_stripe_price_id_by_currency:\s*lastResult\.pricesByCurrency/)
  })

  it("keeps per-mode results apart", () => {
    expect(src).toMatch(/stripeResultsByMode/)
  })

  it("seeds a test sync from the TEST existing-ids map", () => {
    // Handing a test sync the live product id asks Stripe to update a live object with a test key.
    expect(src).toMatch(/mode === "test"[\s\S]{0,160}existingStripeProductIdTest/)
  })
})

describe("every caller supplies both id sets", () => {
  // Enumerated from disk: a caller passing only the live ids silently reverts the fix for whatever
  // path it serves, and would fail nothing else here.
  function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".next" || e.name === ".open-next") continue
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p, out)
      else if (e.name.endsWith(".ts")) out.push(p)
    }
    return out
  }

  const callers = [...walk(path.join(ROOT, "lib")), ...walk(path.join(ROOT, "app"))]
    .map((f) => ({ rel: path.relative(ROOT, f), src: fs.readFileSync(f, "utf8") }))
    .filter((f) => f.src.includes("existingStripeProductId:"))

  it("finds the call sites (an empty sweep would pass everything below)", () => {
    expect(callers.length).toBeGreaterThanOrEqual(1)
  })

  it.each(callers.map((c) => [c.rel, c]))("%s also passes the test ids", (_r, c: any) => {
    expect(c.src).toMatch(/existingStripeProductIdTest:/)
  })
})

describe("the loader selects the columns the fix depends on", () => {
  const src = read("lib/stripe-route-helper.ts")
  // Omit them and `loaded.product.stripe_product_id_test` is undefined forever — the fix would be
  // syntactically present and behaviourally absent, which is the worst of the three states.
  it.each(["stripe_product_id_test", "stripe_price_id_by_currency_test", "live_stripe_ids_verified"])(
    "selects %s",
    (col) => expect(src).toContain(col),
  )
})

describe("/config serves the ids for the mode the caller is in", () => {
  const src = fs.readFileSync(
    path.join(ROOT, "..", "supabase", "functions", "config", "index.ts"),
    "utf8",
  )

  it("threads the resolved mode into the binding resolver", () => {
    expect(src).toMatch(/storeBindingForChain\([\s\S]{0,120}isTestMode\)/)
  })

  it("reads the TEST price map for a test caller", () => {
    expect(src).toMatch(/isTest\s*\n?\s*\?\s*p\.stripe_price_id_by_currency_test/)
  })

  it("does not fall back to the other mode when its own is missing", () => {
    // A cross-mode fallback would hand a test build live price ids — exactly the bug. /config
    // returning null makes the client BLOCK, which is the correct outcome.
    expect(src).not.toMatch(/stripe_price_id_by_currency_test\s*\?\?\s*p\.stripe_price_id_by_currency\b/)
    expect(src).not.toMatch(/stripe_product_id_test\s*\?\?\s*p\.stripe_product_id\b/)
  })
})

describe("migration 147", () => {
  const sql = fs.readFileSync(
    path.join(ROOT, "..", "supabase", "migrations", "147_stripe_ids_mode_scoped.sql"),
    "utf8",
  )

  it("drops the three-argument setter instead of leaving it as an overload", () => {
    // Left in place, PostgREST would resolve an un-updated three-arg caller to it silently, and
    // that caller would keep writing the live columns from a test sync.
    expect(sql).toMatch(/DROP FUNCTION IF EXISTS public\.tenant_products_set_stripe_ids\(uuid, text, jsonb\)/)
  })

  it("refuses an unrecognised mode rather than defaulting to live", () => {
    expect(sql).toMatch(/invalid_mode/)
    expect(sql).not.toMatch(/p_mode\s+TEXT\s+DEFAULT/)
  })

  it("marks legacy live ids unverified rather than trusting them", () => {
    expect(sql).toMatch(/live_stripe_ids_verified/)
  })

  it("adds both test columns and leaves the live ones in place", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS stripe_product_id_test/)
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS stripe_price_id_by_currency_test/)
    // 141's reasoning: clearing the legacy values would break live checkout for every row that DOES
    // hold a live id, trading a latent risk for a certain outage.
    expect(sql).not.toMatch(/UPDATE tenant_products\s+SET\s+stripe_product_id\s*=\s*NULL/i)
  })

  it("is idempotent, per this repo's migration rule", () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS/)
    expect(sql).toMatch(/CREATE OR REPLACE FUNCTION/)
  })
})
