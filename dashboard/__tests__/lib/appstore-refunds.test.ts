import { isRefundPreference, REFUND_PREFERENCES } from "@/lib/appstore-refunds"

// Mirrors migration 207's CHECK (appstore_refund_preference BETWEEN 0 AND 3).
describe("appstore refund preference", () => {
  it("accepts exactly Apple's four values", () => {
    expect([0, 1, 2, 3].every(isRefundPreference)).toBe(true)
    expect([4, -1, 1.5, "1", null].some(isRefundPreference)).toBe(false)
  })
  it("offers every value once", () => {
    expect(REFUND_PREFERENCES.map((p) => p.value).sort()).toEqual([0, 1, 2, 3])
  })
})
