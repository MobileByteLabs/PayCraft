// supabase/functions/checkout-initiate/__tests__/razorpay-return.test.ts
//
// Razorpay's hosted subscription page (`short_url`) has no way to send the buyer back: after paying,
// a ReelExport buyer was left on razorpay.com (user-reported 2026-11-13). Stripe returns them through
// `success_url`. The Razorpay lane now mirrors it: with a valid return_url the buyer is sent to
// PayCraft's pay page, which opens Razorpay Checkout over the subscription and redirects back to the
// SAME tagged URLs Stripe uses. The return URL is stored server-side and never put in the link.
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { razorpayCheckoutTarget } from "../razorpay-return.ts";

const base = {
  subscriptionId: "sub_ABC123",
  shortUrl: "https://rzp.io/rzp/xyz",
  tenantId: "ef8688ea-cd8c-489c-ae52-0b0384fe45db",
  mode: "live" as const,
  keyId: "rzp_live_K",
  payBase: "https://paycraft.mobilebytesensei.com",
  email: "a@b.co",
  productName: "ReelExport Pro — monthly",
};

Deno.test("a browser checkout with a valid return_url goes to the pay page, return stored server-side", () => {
  const t = razorpayCheckoutTarget({ ...base, returnUrl: "https://reelexport.com/checkout/?plan=pro-monthly", origin: "https://reelexport.com" });
  assertEquals(t.url, "https://paycraft.mobilebytesensei.com/pay/razorpay/sub_ABC123");
  assertEquals(t.row?.success_url, "https://reelexport.com/checkout/?plan=pro-monthly&paycraft_checkout=success");
  assertEquals(t.row?.cancel_url, "https://reelexport.com/checkout/?plan=pro-monthly&paycraft_checkout=cancel");
  assertEquals(t.row?.subscription_id, "sub_ABC123");
  assertEquals(t.row?.key_id, "rzp_live_K");
  assertEquals(t.row?.short_url, "https://rzp.io/rzp/xyz");
  // the link itself carries nothing that could redirect elsewhere
  assertEquals(t.url.includes("reelexport"), false);
});

Deno.test("no return_url (KMP apps, server callers) keeps the hosted short_url — unchanged behaviour", () => {
  const t = razorpayCheckoutTarget({ ...base, returnUrl: null, origin: null });
  assertEquals(t.url, "https://rzp.io/rzp/xyz");
  assertEquals(t.row, null);
});

Deno.test("a return_url on another site is refused the same way Stripe refuses it → hosted short_url", () => {
  const t = razorpayCheckoutTarget({ ...base, returnUrl: "https://evil.example/steal", origin: "https://reelexport.com" });
  assertEquals(t.url, "https://rzp.io/rzp/xyz");
  assertEquals(t.row, null);
});

Deno.test("plain http off localhost is refused → hosted short_url", () => {
  const t = razorpayCheckoutTarget({ ...base, returnUrl: "http://reelexport.com/x", origin: "http://reelexport.com" });
  assertEquals(t.row, null);
});

Deno.test("a subscription id that is not Razorpay-shaped never becomes a path segment", () => {
  const t = razorpayCheckoutTarget({ ...base, subscriptionId: "../admin", returnUrl: "https://reelexport.com/x", origin: "https://reelexport.com" });
  assertEquals(t.url, "https://rzp.io/rzp/xyz");
  assertEquals(t.row, null);
});
