import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { invoiceSubscriptionId, subscriptionPeriod } from "../stripe-shape.ts";

Deno.test("pre-basil subscription: period on the subscription", () => {
  const p = subscriptionPeriod({ current_period_start: 100, current_period_end: 200, items: { data: [{}] } });
  assertEquals([p.start?.getTime(), p.end?.getTime()], [100_000, 200_000]);
});

Deno.test("basil+ subscription: period only on the item", () => {
  const p = subscriptionPeriod({ items: { data: [{ current_period_start: 1794215182, current_period_end: 1796807182 }] } });
  assertEquals([p.start?.getTime(), p.end?.getTime()], [1794215182_000, 1796807182_000]);
});

Deno.test("no period anywhere → null, never an Invalid Date", () => {
  assertEquals(subscriptionPeriod({ items: { data: [] } }), { start: null, end: null });
});

Deno.test("invoice subscription id across shapes", () => {
  assertEquals(invoiceSubscriptionId({ subscription: "sub_old" }), "sub_old");
  assertEquals(invoiceSubscriptionId({ subscription: { id: "sub_exp" } }), "sub_exp");
  assertEquals(invoiceSubscriptionId({ parent: { subscription_details: { subscription: "sub_new" } } }), "sub_new");
  assertEquals(invoiceSubscriptionId({ parent: null }), null);
});

import { stripeEventTenant, type StripeLookups } from "../stripe-shape.ts";

const T = "bba1842f-3a57-41cd-8705-94db588de056";
const fake = (lineProduct: string | null = null): StripeLookups => ({
  products: { retrieve: (id) => Promise.resolve(id === "prod_r" ? { metadata: { paycraft_tenant_id: T } } : { metadata: {} }) },
  invoices: { retrieve: () => Promise.resolve({ object: "invoice", lines: { data: [{ price: { product: "prod_r" } }] } }) },
  checkout: { sessions: { listLineItems: () => Promise.resolve({ data: lineProduct ? [{ price: { product: lineProduct } }] : [] }) } },
});

Deno.test("tenant from the object's own metadata", async () => {
  assertEquals(await stripeEventTenant({ object: "subscription", metadata: { paycraft_tenant_id: "t1" } }, fake()), "t1");
});

Deno.test("payment-link subscription (empty metadata) → tenant from its product", async () => {
  const sub = { object: "subscription", metadata: {}, items: { data: [{ price: { product: "prod_r" } }] } };
  assertEquals(await stripeEventTenant(sub, fake()), T);
});

Deno.test("basil invoice line → product → tenant", async () => {
  const inv = { object: "invoice", metadata: {}, lines: { data: [{ pricing: { price_details: { product: "prod_r" } } }] } };
  assertEquals(await stripeEventTenant(inv, fake()), T);
});

Deno.test("checkout session without metadata → line items → tenant", async () => {
  assertEquals(await stripeEventTenant({ object: "checkout.session", id: "cs_1", metadata: {} }, fake("prod_r")), T);
});

Deno.test("refunded charge → invoice → tenant", async () => {
  assertEquals(await stripeEventTenant({ object: "charge", invoice: "in_1" }, fake()), T);
});

Deno.test("unstamped product → null (caller falls back)", async () => {
  const sub = { object: "subscription", items: { data: [{ price: { product: "prod_other" } }] } };
  assertEquals(await stripeEventTenant(sub, fake()), null);
});

Deno.test("basil invoice → its subscription's metadata, without any Stripe lookup", async () => {
  const noCalls: StripeLookups = {
    products: { retrieve: () => Promise.reject(new Error("must not call Stripe")) },
    invoices: { retrieve: () => Promise.reject(new Error("must not call Stripe")) },
    checkout: { sessions: { listLineItems: () => Promise.reject(new Error("must not call Stripe")) } },
  };
  const inv = { object: "invoice", metadata: {}, parent: { subscription_details: { metadata: { paycraft_tenant_id: T } } },
    lines: { data: [{ pricing: { price_details: { product: "prod_unknown" } } }] } };
  assertEquals(await stripeEventTenant(inv, noCalls), T);
});

import { attemptFromSession } from "../stripe-shape.ts";

Deno.test("abandoned checkout → an attempt row with the buyer's email and plan", () => {
  const s = { id: "cs_live_1", livemode: true, customer_details: { email: "Gone@Buyer.test" }, metadata: { plan_id: "pro-annual" } };
  assertEquals(attemptFromSession(s, "abandoned", T), {
    tenant_id: T, provider: "stripe", mode: "live", email: "gone@buyer.test", plan: "pro-annual",
    outcome: "abandoned", provider_session_id: "cs_live_1",
  });
});

Deno.test("an attempt with no email (left before typing it) is not recorded", () => {
  assertEquals(attemptFromSession({ id: "cs_2", livemode: false, metadata: {} }, "abandoned", T), null);
});

Deno.test("no app → not recorded (never a NULL-tenant row)", () => {
  assertEquals(attemptFromSession({ id: "cs_3", customer_email: "a@b.test" }, "abandoned", null), null);
});
