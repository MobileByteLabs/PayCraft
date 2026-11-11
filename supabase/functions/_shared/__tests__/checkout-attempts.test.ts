import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { attemptRow, razorpayAttempt } from "../checkout-attempts.ts";

const T = "bba1842f-3a57-41cd-8705-94db588de056";

Deno.test("attemptRow normalises the email and refuses a row with no app or no email", () => {
  const base = { tenantId: T, provider: "cashfree", mode: "live" as const, plan: "pro", outcome: "abandoned" as const, sessionId: "o1" };
  assertEquals(attemptRow({ ...base, email: " A@B.test " })?.email, "a@b.test");
  assertEquals(attemptRow({ ...base, email: "" }), null);
  assertEquals(attemptRow({ ...base, email: "a@b.test", tenantId: null }), null);
  assertEquals(attemptRow({ ...base, email: "a@b.test", sessionId: "" }), null);
});

Deno.test("Razorpay payment.failed → payment_failed, app + plan from the notes PayCraft set", () => {
  const payload = { payment: { entity: { id: "pay_1", email: "Buyer@X.test", notes: { paycraft_tenant_id: T, paycraft_plan: "pro-monthly" } } } };
  assertEquals(razorpayAttempt("payment.failed", payload, null, "live"), {
    tenant_id: T, provider: "razorpay", mode: "live", email: "buyer@x.test", plan: "pro-monthly",
    outcome: "payment_failed", provider_session_id: "pay_1",
  });
});

Deno.test("the webhook URL's app wins over the notes", () => {
  const payload = { payment: { entity: { id: "pay_2", email: "b@x.test", notes: { paycraft_tenant_id: "other" } } } };
  assertEquals(razorpayAttempt("payment.failed", payload, T, "test")?.tenant_id, T);
});

Deno.test("Razorpay payment_link.expired → abandoned, email from the link's customer", () => {
  const payload = { payment_link: { entity: { id: "plink_1", customer: { email: "c@x.test" }, notes: { paycraft_tenant_id: T, paycraft_plan: "coins-100" } } } };
  assertEquals(razorpayAttempt("payment_link.expired", payload, null, "live")?.outcome, "abandoned");
  assertEquals(razorpayAttempt("payment_link.expired", payload, null, "live")?.provider_session_id, "plink_1");
});

Deno.test("other Razorpay events and unattributable ones are not attempts", () => {
  assertEquals(razorpayAttempt("payment.captured", { payment: { entity: { id: "p", email: "a@b.test" } } }, T, "live"), null);
  assertEquals(razorpayAttempt("payment.failed", { payment: { entity: { id: "p", email: "a@b.test", notes: {} } } }, null, "live"), null);
});
