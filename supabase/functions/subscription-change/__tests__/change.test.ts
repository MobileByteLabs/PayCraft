// supabase/functions/subscription-change/__tests__/change.test.ts
//
// Moving a subscriber between plans (migration 197). Run: deno test supabase/functions/subscription-change/__tests__/change.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { changeKind, currencyOf, razorpayChangeBody, refusal, stripeChangeForm } from "../change.ts"

const sub = { provider: "stripe", provider_subscription_id: "sub_1", plan: "plus-monthly", pending_plan: null, plan_changes_at: null }
const max = { sku: "max5-monthly", type: "subscription" }

Deno.test("refuses what cannot be changed, with a status the caller can act on", () => {
  assertEquals(refusal(null, "max5-monthly", max), { error: "no_subscription", status: 404 })
  assertEquals(refusal(sub, "plus-monthly", { sku: "plus-monthly", type: "subscription" }), { error: "same_plan", status: 409 })
  assertEquals(refusal(sub, "nope", null), { error: "plan_not_found", status: 404 })
  assertEquals(refusal(sub, "credits-150", { sku: "credits-150", type: "consumable" }), { error: "not_a_subscription_plan", status: 409 })
  assertEquals(refusal({ ...sub, provider: "google_play" }, "max5-monthly", max), { error: "change_unsupported_for_provider", status: 501 })
  assertEquals(refusal({ ...sub, provider_subscription_id: null }, "max5-monthly", max), { error: "change_unsupported_for_provider", status: 501 })
  assertEquals(refusal({ ...sub, pending_plan: "pro-monthly", plan_changes_at: "2099-01-01T00:00:00Z" }, "max5-monthly", max), { error: "change_already_scheduled", status: 409 })
  // a scheduled change that has already taken effect does not block the next one
  assertEquals(refusal({ ...sub, pending_plan: "pro-monthly", plan_changes_at: "2020-01-01T00:00:00Z" }, "max5-monthly", max), null)
  assertEquals(refusal(sub, "max5-monthly", max), null)
  assertEquals(refusal({ ...sub, provider: "razorpay" }, "max5-monthly", max), null)
})

Deno.test("the subscription's currency is read back from the product's own id map", () => {
  assertEquals(currencyOf({ INR: "plan_in", USD: "plan_us" }, "plan_us"), "USD")
  assertEquals(currencyOf({ INR: "plan_in" }, "plan_other"), null)
  assertEquals(currencyOf(null, "plan_in"), null)
})

Deno.test("Stripe: swap the one item's price and invoice the proration now", () => {
  const f = stripeChangeForm("si_1", "price_max", "max5-monthly")
  assertEquals(f.get("items[0][id]"), "si_1")
  assertEquals(f.get("items[0][price]"), "price_max")
  assertEquals(f.get("proration_behavior"), "always_invoice")
  assertEquals(f.get("metadata[plan_id]"), "max5-monthly") // the webhook reads plan_id from metadata
})

Deno.test("Razorpay: swap the plan at the end of the cycle (no undocumented mid-cycle proration)", () => {
  assertEquals(razorpayChangeBody("plan_max"), { plan_id: "plan_max", schedule_change_at: "cycle_end" })
})

Deno.test("choosing the current plan while a change is scheduled cancels that change (keep my plan)", () => {
  const pending = { ...sub, provider: "razorpay", pending_plan: "max5-monthly", plan_changes_at: "2099-01-01T00:00:00Z" }
  assertEquals(changeKind(pending, "plus-monthly"), "cancel-scheduled")
  assertEquals(refusal(pending, "plus-monthly", { sku: "plus-monthly", type: "subscription" }), null)
  assertEquals(changeKind(pending, "max5-monthly"), "change") // re-choosing the scheduled one is still "already scheduled"
  assertEquals(refusal(pending, "max5-monthly", max), { error: "change_already_scheduled", status: 409 })
  assertEquals(changeKind(sub, "max5-monthly"), "change")
})
