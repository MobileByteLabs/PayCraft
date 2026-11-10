// supabase/functions/checkout-initiate/__tests__/stripe-session.test.ts
//
// The Stripe lane of checkout-initiate: a web buyer outside India (cmp-paycraft-web routes by region)
// gets a per-customer Stripe Checkout Session when the product has no payment link.
//
// Run: deno test supabase/functions/checkout-initiate/__tests__/stripe-session.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { pickByCurrency, returnUrls, stripeSessionForm } from "../stripe-session.ts"

Deno.test("pickByCurrency: requested currency, else the single configured one, else an error", () => {
  assertEquals(pickByCurrency({ USD: "price_usd", EUR: "price_eur" }, "eur", "Stripe price"), {
    id: "price_eur",
    currency: "EUR",
  })
  assertEquals(pickByCurrency({ USD: "price_usd" }, "GBP", "Stripe price"), { id: "price_usd", currency: "USD" })
  assertEquals("error" in pickByCurrency({ USD: "a", EUR: "b" }, "GBP", "Stripe price"), true)
  assertEquals("error" in pickByCurrency({}, "USD", "Stripe price"), true)
  assertEquals("error" in pickByCurrency(null, "USD", "Stripe price"), true)
})

Deno.test("returnUrls: the buyer comes back to the page they bought from", () => {
  const r = returnUrls("https://reelsdownloader.in/pricing/?ref=x", "https://reelsdownloader.in")
  assertEquals(r, {
    success: "https://reelsdownloader.in/pricing/?ref=x&paycraft_checkout=success",
    cancel: "https://reelsdownloader.in/pricing/?ref=x&paycraft_checkout=cancel",
  })
  // local development is allowed over http
  assertEquals("success" in returnUrls("http://localhost:4321/pricing/", "http://localhost:4321"), true)
})

Deno.test("returnUrls: refuses an open redirect", () => {
  // another site than the one calling
  assertEquals("error" in returnUrls("https://evil.test/x", "https://reelsdownloader.in"), true)
  // plain http on a real host
  assertEquals("error" in returnUrls("http://reelsdownloader.in/", "http://reelsdownloader.in"), true)
  // no Origin (not a browser) and nothing to return to
  assertEquals("error" in returnUrls(null, null), true)
  assertEquals("error" in returnUrls("not a url", "https://reelsdownloader.in"), true)
})

Deno.test("stripeSessionForm: subscription for one price, email + metadata stripe-webhook reads, trial", () => {
  const form = stripeSessionForm({
    priceId: "price_usd",
    email: "a+b@mail.test",
    sku: "pro-monthly",
    tenantId: "t1",
    productId: "p1",
    mode: "live",
    trialDays: 14,
    success: "https://s/ok",
    cancel: "https://s/no",
  })
  const p = new URLSearchParams(form)
  assertEquals(p.get("mode"), "subscription")
  assertEquals(p.get("line_items[0][price]"), "price_usd")
  assertEquals(p.get("line_items[0][quantity]"), "1")
  assertEquals(p.get("customer_email"), "a+b@mail.test")
  assertEquals(p.get("success_url"), "https://s/ok")
  assertEquals(p.get("cancel_url"), "https://s/no")
  // stripe-webhook grants the plan from session.metadata.plan_id (and the subscription's on renewals)
  assertEquals(p.get("metadata[plan_id]"), "pro-monthly")
  assertEquals(p.get("subscription_data[metadata][plan_id]"), "pro-monthly")
  assertEquals(p.get("metadata[paycraft_tenant_id]"), "t1")
  assertEquals(p.get("metadata[paycraft_email]"), "a+b@mail.test")
  assertEquals(p.get("metadata[paycraft_mode]"), "live")
  assertEquals(p.get("subscription_data[trial_period_days]"), "14")

  const noTrial = new URLSearchParams(stripeSessionForm({
    priceId: "p", email: "e@x.y", sku: "s", tenantId: "t", productId: "p", mode: "test", trialDays: 0,
    success: "https://s/ok", cancel: "https://s/no",
  }))
  assertEquals(noTrial.has("subscription_data[trial_period_days]"), false)
})
