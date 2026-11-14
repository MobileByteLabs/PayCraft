/**
 * /pay/razorpay/{subscription_id} — the page that brings a Razorpay buyer back to the site.
 *
 * Razorpay's hosted subscription page cannot redirect, so a ReelExport buyer who paid stayed on
 * razorpay.com (2026-11-13). This page opens Razorpay Checkout over the subscription and, on success,
 * sends the buyer to the success URL checkout-initiate stored (migration 192) — the same tagged URL
 * Stripe's success_url uses. Nothing in the link decides where the buyer goes.
 */
import { checkoutOptionsFor, isSubscriptionId, type RazorpayReturnRow } from "@/lib/razorpay-pay"

const row: RazorpayReturnRow = {
  subscription_id: "sub_Tzir8NeD3YqfMZ",
  tenant_id: "ef8688ea-cd8c-489c-ae52-0b0384fe45db",
  mode: "live",
  key_id: "rzp_live_PUBLIC",
  success_url: "https://reelexport.com/checkout/?plan=pro-monthly&paycraft_checkout=success",
  cancel_url: "https://reelexport.com/checkout/?plan=pro-monthly&paycraft_checkout=cancel",
  short_url: "https://rzp.io/rzp/abc",
  email: "buyer@example.com",
  product_name: "ReelExport Pro — monthly",
}

test("only Razorpay-shaped subscription ids are looked up", () => {
  expect(isSubscriptionId("sub_Tzir8NeD3YqfMZ")).toBe(true)
  for (const bad of ["", "../admin", "sub_", "sub_abc;drop", "pay_Tzir8NeD3YqfMZ", "sub_" + "a".repeat(60)]) {
    expect(isSubscriptionId(bad)).toBe(false)
  }
})

test("Checkout opens the stored subscription with the public key and the buyer's email", () => {
  const o = checkoutOptionsFor(row)
  expect(o.key).toBe("rzp_live_PUBLIC")
  expect(o.subscription_id).toBe("sub_Tzir8NeD3YqfMZ")
  expect(o.description).toBe("ReelExport Pro — monthly")
  expect(o.prefill).toEqual({ email: "buyer@example.com" })
})

test("success and dismiss go to the STORED urls — never anything from the request", () => {
  const o = checkoutOptionsFor(row)
  expect(o.successUrl).toBe(row.success_url)
  expect(o.cancelUrl).toBe(row.cancel_url)
})

test("a stored url that is not http(s) is never used as a redirect", () => {
  const o = checkoutOptionsFor({ ...row, success_url: "javascript:alert(1)", cancel_url: "data:text/html,x" })
  expect(o.successUrl).toBe(row.short_url)
  expect(o.cancelUrl).toBe(row.short_url)
})

test("no email → no prefill (never an empty string Razorpay would show)", () => {
  expect(checkoutOptionsFor({ ...row, email: null }).prefill).toEqual({})
})
