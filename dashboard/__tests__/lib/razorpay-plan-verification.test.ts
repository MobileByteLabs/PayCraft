/**
 * Plan verification: a stored Razorpay plan id is a CLAIM about the provider's state, not a fact.
 *
 * The sync used to trust it absolutely — `if (planIdsByCurrency[ccyKey]) continue` — which is wrong
 * whenever local state and Razorpay disagree: a plan deleted at the provider, or an id written by a
 * sync against a different account (test keys swapped for live, a merchant re-connected). The stored
 * id then resolves to nothing, every later sync reports "ok", and the breakage only appears when a
 * buyer taps Continue.
 *
 * Mocked deliberately, and legitimately: the branch under test fires only when Razorpay 404s a plan,
 * and provoking that against a live account means creating a throwaway plan in a real merchant's
 * catalogue. The e2e suite covers the real-stack half (`tests/e2e/`, no stubs); this covers the
 * failure branch that cannot be staged safely.
 */

const mockPlansFetch = jest.fn()
const mockPlansCreate = jest.fn()
const mockRegistrationLink = jest.fn()

jest.mock("@/lib/razorpay-client", () => ({
  getConnectedRazorpayClient: jest.fn(async () => ({
    plans: { fetch: mockPlansFetch, create: mockPlansCreate },
    paymentLink: { create: jest.fn() },
    subscriptionRegistration: { createRegistrationLink: mockRegistrationLink },
  })),
}))

import { syncProductToRazorpay } from "@/lib/razorpay-product-sync"

/** Razorpay's REST shim rejects with an Error carrying `statusCode`. */
function razorpayError(statusCode: number, description: string) {
  const e = new Error(description) as Error & { statusCode?: number; error?: unknown }
  e.statusCode = statusCode
  e.error = { description }
  return e
}

beforeEach(() => {
  jest.clearAllMocks()
})

const PRICES = [{ currency: "INR", amountCents: 125999 }]

describe("razorpay plan verification", () => {
  it("reuses a stored plan id that still exists at Razorpay", async () => {
    mockPlansFetch.mockResolvedValue({ id: "plan_EXISTING" })

    const result = await syncProductToRazorpay(
      "tenant-1",
      "product-1",
      "Cappy Plus (Annual)",
      "subscription",
      "year",
      PRICES,
      "live",
      { INR: "plan_EXISTING" },
    )

    expect(mockPlansFetch).toHaveBeenCalledWith("plan_EXISTING")
    expect(mockPlansCreate).not.toHaveBeenCalled()
    expect(result.planIdsByCurrency.INR).toBe("plan_EXISTING")
    expect(result.recreatedPlanIds).toEqual([])
  })

  it("recreates a stored plan id that Razorpay no longer has, and reports the drift", async () => {
    mockPlansFetch.mockRejectedValue(razorpayError(404, "The id provided does not exist"))
    mockPlansCreate.mockResolvedValue({ id: "plan_REBUILT" })

    const result = await syncProductToRazorpay(
      "tenant-1",
      "product-1",
      "Cappy Plus (Annual)",
      "subscription",
      "year",
      PRICES,
      "live",
      { INR: "plan_GONE" },
    )

    expect(mockPlansFetch).toHaveBeenCalledWith("plan_GONE")
    expect(mockPlansCreate).toHaveBeenCalledTimes(1)
    expect(result.planIdsByCurrency.INR).toBe("plan_REBUILT")
    expect(
      result.recreatedPlanIds,
      // Naming the dead id matters: "a plan was recreated" is not actionable, "INR:plan_GONE was
      // missing" tells the operator their account or key mode changed underneath them.
    ).toEqual(["INR:plan_GONE"])
  })

  it("does NOT recreate on a transient error — only on a genuine not-found", async () => {
    // A 500 or a network blip must not be read as "the plan is gone". Recreating then would leave
    // TWO live plans for one product, and the buyer could be billed against either.
    mockPlansFetch.mockRejectedValue(razorpayError(500, "Internal Server Error"))

    await expect(
      syncProductToRazorpay(
        "tenant-1",
        "product-1",
        "Cappy Plus (Annual)",
        "subscription",
        "year",
        PRICES,
        "live",
        { INR: "plan_EXISTING" },
      ),
    ).rejects.toThrow(/Internal Server Error/)

    expect(mockPlansCreate).not.toHaveBeenCalled()
  })

  it("records why a subscription has no checkout link instead of reporting a clean success", async () => {
    mockPlansFetch.mockResolvedValue({ id: "plan_EXISTING" })

    const result = await syncProductToRazorpay(
      "tenant-1",
      "product-1",
      "Cappy Plus (Annual)",
      "subscription",
      "year",
      PRICES,
      "live",
      { INR: "plan_EXISTING" },
    )

    // A recurring plan has no reusable link by Razorpay's design; the sync must say so rather than
    // leave `{sku:{}}` behind a green "ok".
    expect(Object.keys(result.paymentLinksByCurrency)).toHaveLength(0)
    expect(result.linkFailuresByCurrency.INR).toMatch(/per customer|no reusable link/i)
  })
})
