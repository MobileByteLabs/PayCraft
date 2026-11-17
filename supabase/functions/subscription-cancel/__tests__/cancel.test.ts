// supabase/functions/subscription-cancel/__tests__/cancel.test.ts
//
// A member cancels their own subscription (2026-11-17 — PayCraft had no cancel path at all).
// Run: deno test supabase/functions/subscription-cancel/__tests__/cancel.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { cancelRefusal, razorpayCancelBody, stripeCancelForm } from "../cancel.ts"

const sub = { provider: "stripe", provider_subscription_id: "sub_1", cancel_at_period_end: false }

Deno.test("refuses what cannot be cancelled here, with a status the caller can act on", () => {
  assertEquals(cancelRefusal(null), { error: "no_subscription", status: 404 })
  // stores cancel in their own UI (Play / App Store subscription settings)
  assertEquals(cancelRefusal({ ...sub, provider: "google_play" }), { error: "cancel_in_store", status: 501 })
  assertEquals(cancelRefusal({ ...sub, provider: "app_store" }), { error: "cancel_in_store", status: 501 })
  assertEquals(cancelRefusal({ ...sub, provider_subscription_id: null }), { error: "cancel_unsupported_for_provider", status: 501 })
  assertEquals(cancelRefusal({ ...sub, cancel_at_period_end: true }), { error: "already_cancelled", status: 409 })
  assertEquals(cancelRefusal(sub), null)
  assertEquals(cancelRefusal({ ...sub, provider: "razorpay" }), null)
})

Deno.test("Stripe keeps the plan until the period ends, never a refund-less immediate stop", () => {
  assertEquals(Object.fromEntries(stripeCancelForm()), { cancel_at_period_end: "true" })
})

Deno.test("Razorpay cancels at the end of the current cycle", () => {
  assertEquals(razorpayCancelBody(), { cancel_at_cycle_end: 1 })
})
