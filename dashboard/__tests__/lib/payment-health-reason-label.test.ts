// "Why payments failed" (paycraft-attempt-observability sub-plan 07): each failure code reads in words with the code
// kept beside it, so an owner can act on it and still search for it.
import { reasonLabel } from "@/components/analytics/payment-health"

describe("reasonLabel", () => {
  it("names the known codes", () => {
    expect(reasonLabel("product_not_found")).toBe("Store had no such product (product_not_found)")
    expect(reasonLabel("query_2")).toBe("Store product lookup failed (query_2)")
    expect(reasonLabel("not_from_play")).toBe("App not installed from Google Play (not_from_play)")
    expect(reasonLabel("purchase_3")).toBe("Store declined the purchase (purchase_3)")
    expect(reasonLabel("unknown")).toBe("Not reported (older SDK)")
  })

  it("shows an unrecognised code as-is rather than guessing", () => {
    expect(reasonLabel("webhook_sig_mismatch")).toBe("webhook_sig_mismatch")
  })
})
