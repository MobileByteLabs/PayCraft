// The per-platform provider list (Providers → Platform providers): any number of providers in the order
// the merchant ranks them, saved as the routing rule's `priority_methods`. The web shows buyers every
// provider on this list that can charge their price, in this order.
import {
  addProvider,
  moveProvider,
  providersFromRule,
  removeProvider,
  toPriorityMethods,
} from "@/lib/platform-provider-order"

const methodToProvider = new Map([
  ["stripe_card", "stripe"],
  ["razorpay_upi", "razorpay"],
  ["razorpay_card", "razorpay"],
  ["cashfree_upi", "cashfree"],
  ["play_billing", "google_play"],
])
const cheapestMethod = new Map([
  ["stripe", "stripe_card"],
  ["razorpay", "razorpay_upi"],
  ["cashfree", "cashfree_upi"],
  ["google_play", "play_billing"],
])
const WEB = new Set(["stripe", "razorpay", "cashfree", "direct_upi"])

describe("platform provider order", () => {
  it("reads EVERY provider of a rule in order — not just the first two — once each", () => {
    expect(providersFromRule(["razorpay_upi", "stripe_card", "razorpay_card", "cashfree_upi"], methodToProvider))
      .toEqual(["razorpay", "stripe", "cashfree"])
    expect(providersFromRule(["unknown_method", "stripe_card"], methodToProvider)).toEqual(["stripe"])
  })

  it("adds at the end, never twice", () => {
    expect(addProvider(["stripe"], "razorpay")).toEqual(["stripe", "razorpay"])
    expect(addProvider(["stripe", "razorpay"], "stripe")).toEqual(["stripe", "razorpay"])
  })

  it("moves up and down within bounds", () => {
    expect(moveProvider(["a", "b", "c"], 2, -1)).toEqual(["a", "c", "b"])
    expect(moveProvider(["a", "b", "c"], 0, -1)).toEqual(["a", "b", "c"])
    expect(moveProvider(["a", "b", "c"], 2, 1)).toEqual(["a", "b", "c"])
    expect(moveProvider(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"])
  })

  it("removes by position", () => {
    expect(removeProvider(["a", "b", "c"], 1)).toEqual(["a", "c"])
  })

  it("saves each provider's cheapest method, in order; web providers only when connected, native always", () => {
    const connected = new Set(["stripe", "razorpay"])
    expect(toPriorityMethods(["google_play", "razorpay", "stripe", "cashfree"], cheapestMethod, connected, WEB))
      .toEqual(["play_billing", "razorpay_upi", "stripe_card"])
  })
})
