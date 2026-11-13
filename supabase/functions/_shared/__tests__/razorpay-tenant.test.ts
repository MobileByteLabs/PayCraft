import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { razorpayNotesTenantId, razorpayNotesProductId } from "../razorpay-tenant.ts";

const T = "ef8688ea-cd8c-489c-ae52-0b0384fe45db";
const P = "45743328-b9af-43d2-8ae6-fd60fd04261f";

// One org Razorpay account is shared by several apps, and a Razorpay webhook URL can carry only one
// tenant — so the shared account's webhook arrives tenant-less. checkout-initiate stamps
// notes.paycraft_tenant_id on every subscription it creates; that is where the app comes from.
Deno.test("subscription event: tenant from subscription notes", () => {
  const env = { event: "subscription.charged", payload: { subscription: { entity: { notes: { paycraft_tenant_id: T } } } } };
  assertEquals(razorpayNotesTenantId(env), T);
});

Deno.test("payment event: tenant from payment notes when no subscription envelope", () => {
  const env = { event: "payment.captured", payload: { payment: { entity: { notes: { paycraft_tenant_id: T } } } } };
  assertEquals(razorpayNotesTenantId(env), T);
});

Deno.test("order / payment_link notes are read too", () => {
  assertEquals(razorpayNotesTenantId({ payload: { order: { entity: { notes: { paycraft_tenant_id: T } } } } }), T);
  assertEquals(razorpayNotesTenantId({ payload: { payment_link: { entity: { notes: { paycraft_tenant_id: T } } } } }), T);
});

Deno.test("subscription notes win over payment notes", () => {
  const other = "bba1842f-3a57-41cd-8705-94db588de056";
  const env = { payload: { subscription: { entity: { notes: { paycraft_tenant_id: T } } }, payment: { entity: { notes: { paycraft_tenant_id: other } } } } };
  assertEquals(razorpayNotesTenantId(env), T);
});

Deno.test("non-UUID or missing tenant note yields null (never a guessed tenant)", () => {
  assertEquals(razorpayNotesTenantId({ payload: { subscription: { entity: { notes: { paycraft_tenant_id: "x; drop" } } } } }), null);
  assertEquals(razorpayNotesTenantId({ payload: { subscription: { entity: { notes: [] } } } }), null);
  assertEquals(razorpayNotesTenantId({ payload: {} }), null);
  assertEquals(razorpayNotesTenantId(null), null);
});

Deno.test("product id from payment-link notes (consumables carry the product, not the tenant)", () => {
  assertEquals(razorpayNotesProductId({ payload: { payment: { entity: { notes: { paycraft_product_id: P } } } } }), P);
  assertEquals(razorpayNotesProductId({ payload: { payment: { entity: { notes: { paycraft_product_id: "edits-10" } } } } }), null);
});
