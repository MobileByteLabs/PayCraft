// supabase/functions/checkout-initiate/__tests__/razorpay-subscription.test.ts
//
// The Razorpay lane of checkout-initiate: the Subscription body. Its `notes` are echoed on every webhook, so
// they are how razorpay-webhook finds the app, the buyer and — since migration 210 — the SDK's attempt.
//
// Run: deno test supabase/functions/checkout-initiate/__tests__/razorpay-subscription.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { razorpaySubscriptionPayload, totalCountFor } from "../razorpay-subscription.ts"

const base = {
  planId: "plan_INR",
  interval: "month",
  email: "a@b.test",
  phone: null,
  name: null,
  tenantId: "t1",
  productId: "p1",
  sku: "pro-monthly",
  mode: "test" as const,
  trialDays: 0,
  nowSeconds: 1_764_000_000,
}

Deno.test("razorpaySubscriptionPayload: notes carry the app, plan, buyer, mode — and the attempt id when the SDK sent one", () => {
  const p = razorpaySubscriptionPayload({ ...base, attemptId: "att-r1" })
  assertEquals(p.plan_id, "plan_INR")
  assertEquals(p.total_count, 120)
  assertEquals(p.customer_notify, 1)
  assertEquals(p.notify_info, { notify_email: "a@b.test" })
  assertEquals(p.notes, {
    paycraft_tenant_id: "t1",
    paycraft_product_id: "p1",
    paycraft_plan: "pro-monthly",
    paycraft_email: "a@b.test",
    paycraft_mode: "test",
    attempt_id: "att-r1",
  })
  assertEquals("start_at" in p, false)
})

Deno.test("razorpaySubscriptionPayload: an older SDK (no attempt id) gets exactly the old notes", () => {
  const p = razorpaySubscriptionPayload({ ...base, attemptId: null, name: "Asha", phone: "+919999999999" })
  assertEquals((p.notes as Record<string, unknown>).attempt_id, undefined)
  assertEquals((p.notes as Record<string, unknown>).paycraft_customer_name, "Asha")
  assertEquals(p.notify_info, { notify_email: "a@b.test", notify_phone: "+919999999999" })
})

Deno.test("razorpaySubscriptionPayload: a trial is the gap to start_at; a win-back offer rides as offer_id + note", () => {
  const p = razorpaySubscriptionPayload({ ...base, trialDays: 7, winback: { razorpayOfferId: "offer_1", offerId: "wb-1" } })
  assertEquals(p.start_at, base.nowSeconds + 7 * 86_400)
  assertEquals(p.offer_id, "offer_1")
  assertEquals((p.notes as Record<string, unknown>).paycraft_winback_offer, "wb-1")
})

Deno.test("totalCountFor: ~10 years inside Razorpay's per-period caps", () => {
  assertEquals(totalCountFor("year"), 100)
  assertEquals(totalCountFor("semiannual"), 20)
  assertEquals(totalCountFor("quarter"), 40)
  assertEquals(totalCountFor("month"), 120)
})
