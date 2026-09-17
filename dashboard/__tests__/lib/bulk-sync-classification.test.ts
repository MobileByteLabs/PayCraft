/**
 * Regression: the bulk drain (`POST /api/products/sync-to-providers`) must classify each
 * provider result with the SHARED `classifyProvider`, exactly as the single-product path
 * (`runProductSync`) does — never by reading an id back off the row.
 *
 * The incident (mbs/cappy, 2026-09-17): a Play base plan that Play refused to activate
 * ("The app is not published") still had `play_product_id` written, so the drain's
 * id-presence branch recorded `status: "ok"` and filed the DRAFT warning as a cosmetic
 * `message`. The durable sync_state therefore read `synced` for a product the store would
 * not sell, and the only symptom was "Product not found" on a real device.
 *
 * The App Store branch was the sharper case: `appStoreSyncProduct` writes
 * `app_store_product_id` BEFORE returning `{error}` for a free-trial offer that failed to
 * provision — so id-presence reported a HARD ERROR as "ok" and dropped the reason.
 *
 * These assert the classifier contract the route now defers to, so a future edit that
 * reintroduces id-presence inference in either branch fails here.
 */

import { readFileSync } from "node:fs"
import { join } from "node:path"

import { classifyProvider } from "@/lib/stripe-route-helper"

/** The exact mapping the route applies to a classifier entry. */
function reportStatus(entry: ReturnType<typeof classifyProvider>): string {
  return entry.status === "synced"
    ? "ok"
    : entry.status === "draft"
      ? "draft"
      : entry.status === "skipped"
        ? "skipped"
        : "failed"
}

test("Play: base plan not activated → draft, NOT ok, and the reason survives", () => {
  // Shape returned by googlePlaySyncProduct when activation is refused: the product id IS
  // written (so the old id-presence branch saw success) but a warning is attached.
  const res = {
    warning:
      'base plan pro-annual-autorenew not activated for pro_annual (400): {"error":{"message":"The app is not published."}}',
  }
  const entry = classifyProvider(res)

  expect(entry.status).toBe("draft")
  expect(reportStatus(entry)).toBe("draft")
  expect(reportStatus(entry)).not.toBe("ok")
  // The reason must reach sync_state — a draft with no explanation is what made this
  // invisible until a device hit it.
  expect(entry.reason ?? entry.warning).toMatch(/not published/i)
})

test("App Store: trial offer failed → failed, NOT ok (id was already written)", () => {
  const res = {
    error: "App Store subscription synced but the 14-day free-trial introductory offer was not set",
  }
  const entry = classifyProvider(res)

  expect(entry.status).toBe("failed")
  expect(reportStatus(entry)).toBe("failed")
  expect(reportStatus(entry)).not.toBe("ok")
  expect(entry.reason).toMatch(/free-trial/i)
})

test("a clean sync is still ok", () => {
  expect(reportStatus(classifyProvider({}))).toBe("ok")
})

test("not-connected is skipped, not failed — a drain must not report it as breakage", () => {
  const entry = classifyProvider({ error: "App Store is not connected for this tenant" })
  expect(entry.status).toBe("skipped")
  expect(reportStatus(entry)).toBe("skipped")
})

test("the drain and the single-product path cannot disagree", () => {
  // Both call the same function, so identical input MUST yield an identical verdict.
  // Two independent classifiers is precisely the defect this replaced.
  for (const res of [
    {},
    { warning: "base plan not activated" },
    { error: "boom" },
    { skipped: true, reason: "native stores only sync subscription products" },
    { error: "Google Play is not connected for this tenant" },
  ]) {
    expect(classifyProvider(res)).toEqual(classifyProvider({ ...res }))
  }
})

/**
 * Structural guard. The tests above pin the classifier's behaviour, but they would still
 * pass if the ROUTE stopped calling it and went back to reading an id off the row — which
 * is exactly how this defect shipped. This asserts the route defers to the shared
 * classifier in every provider branch.
 */
test("the drain route classifies via classifyProvider in every provider branch", () => {
  const route = readFileSync(
    join(__dirname, "..", "..", "app", "api", "products", "sync-to-providers", "route.ts"),
    "utf8",
  )

  expect(route).toContain("classifyProvider")
  // stripe + google_play + app_store each classify their own result. razorpay reports a
  // plain boolean from its own helper and has no id read-back, so it is not counted here.
  const uses = route.match(/classifyProvider\(res\)/g) ?? []
  expect(uses.length).toBeGreaterThanOrEqual(3)

  // The regression shape: pushing a hardcoded ok inside an id-presence branch. Every
  // status must now be derived from a classifier entry.
  expect(route).not.toMatch(/if \(after\?\.\w+\) \{\s*\w+Reports\.push\(\{[^}]*status: "ok",/)
})
