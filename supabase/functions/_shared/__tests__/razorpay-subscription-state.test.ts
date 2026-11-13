import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { razorpaySubscriptionState } from "../razorpay-subscription-state.ts";

// Razorpay's lifecycle: created → authenticated (mandate + upfront amount) → active (at start_at) → charged…
// With a trial, start_at is in the future and the subscription sits in `authenticated` for the whole trial;
// `subscription.activated` fires only when the trial ENDS. PayCraft used to ignore `authenticated`, so a
// buyer who started a 14-day trial got nothing for 14 days — Stripe grants access while `trialing`.
const NOW = Date.UTC(2026, 10, 13, 12) / 1000;
const DAY = 86_400;
const trialSub = {
  id: "sub_1", customer_id: "cust_1", plan_id: "plan_1",
  created_at: NOW - 60, start_at: NOW + 14 * DAY,
  notes: { paycraft_email: "a@b.co", paycraft_plan: "pro-monthly" },
};
const plainSub = { ...trialSub, start_at: NOW - 30, current_start: NOW - 30, current_end: NOW + 30 * DAY };

Deno.test("authenticated inside a trial → trialing until start_at, with the buyer's identity", () => {
  const s = razorpaySubscriptionState("subscription.authenticated", trialSub, NOW)!;
  assertEquals(s.status, "trialing");
  assertEquals(s.trialEnd?.getTime(), (NOW + 14 * DAY) * 1000);
  assertEquals(s.periodEnd?.getTime(), (NOW + 14 * DAY) * 1000);
  assertEquals(s.email, "a@b.co");
  assertEquals(s.plan, "pro-monthly");
  assertEquals(s.customerId, "cust_1");
});

Deno.test("authenticated with no trial is not a state change (activated follows at once)", () => {
  assertEquals(razorpaySubscriptionState("subscription.authenticated", plainSub, NOW), null);
});

Deno.test("activated after the trial → active with the billing period", () => {
  const s = razorpaySubscriptionState("subscription.activated", { ...plainSub, created_at: NOW - 15 * DAY }, NOW)!;
  assertEquals(s.status, "active");
  assertEquals(s.periodEnd?.getTime(), (NOW + 30 * DAY) * 1000);
  assertEquals(s.email, "a@b.co");
});

Deno.test("charged → active; carries no identity (the subscription row already has it)", () => {
  const s = razorpaySubscriptionState("subscription.charged", plainSub, NOW)!;
  assertEquals(s.status, "active");
  assertEquals(s.email, null);
  assertEquals(s.plan, null);
});

Deno.test("pending and halted → past_due; paused → paused; resumed → active", () => {
  assertEquals(razorpaySubscriptionState("subscription.pending", plainSub, NOW)!.status, "past_due");
  assertEquals(razorpaySubscriptionState("subscription.halted", plainSub, NOW)!.status, "past_due");
  assertEquals(razorpaySubscriptionState("subscription.paused", plainSub, NOW)!.status, "paused");
  assertEquals(razorpaySubscriptionState("subscription.resumed", plainSub, NOW)!.status, "active");
});

Deno.test("cancelled and completed → canceled, ending at ended_at", () => {
  for (const ev of ["subscription.cancelled", "subscription.completed"]) {
    const s = razorpaySubscriptionState(ev, { ...plainSub, ended_at: NOW }, NOW)!;
    assertEquals(s.status, "canceled");
    assertEquals(s.periodEnd?.getTime(), NOW * 1000);
    assertEquals(s.cancelAtPeriodEnd, true);
  }
});

Deno.test("events PayCraft does not act on → null", () => {
  assertEquals(razorpaySubscriptionState("subscription.updated", plainSub, NOW), null);
  assertEquals(razorpaySubscriptionState("payment.captured", plainSub, NOW), null);
});
