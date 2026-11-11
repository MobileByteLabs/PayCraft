import { detailHref, displayId, providerLabel, searchTerm, statusesFor } from "@/lib/customers"

describe("customer list rules", () => {
  it("Churned covers web canceled and store cancelled/expired", () => {
    expect(statusesFor("churned")).toEqual(expect.arrayContaining(["canceled", "cancelled", "expired"]))
  })

  it("an unknown filter passes through; no filter means all", () => {
    expect(statusesFor("paused")).toEqual(["paused"])
    expect(statusesFor(undefined)).toBeNull()
  })

  it("search text cannot break out of the or() expression", () => {
    expect(searchTerm("a,b(c)*")).toBe("a b c")
    expect(searchTerm("  ")).toBeNull()
  })

  it("store providers get human names", () => {
    expect(providerLabel("google_play")).toBe("Google Play")
    expect(providerLabel(null)).toBe("—")
  })

  it("only web subscriptions link to the detail page", () => {
    expect(detailHref({ source: "subscription", row_id: "u1" })).toBe("/subscribers/u1")
    expect(detailHref({ source: "store", row_id: "u2" })).toBeNull()
    expect(detailHref({ source: "attempt", row_id: "u3" })).toBeNull()
  })

  it("a store buyer is identified by their app user id", () => {
    expect(displayId({ source: "store", row_id: "x", app_user_id: "9be33ff4edf3fbe8" })).toBe("9be33ff4ed")
  })
})
