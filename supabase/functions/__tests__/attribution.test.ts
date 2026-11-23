// Attribution forwarding (migration 208): which store/PSP change is a trial start, purchase, renewal or refund,
// and the GA4 Measurement Protocol / AppsFlyer S2S bodies sent for it — no value when the price is unknown.
// Run: deno test --no-check supabase/functions/__tests__/attribution.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  afEventTime, appsFlyerPayload, detectTransition, forwardLifecycle, forwardTxnId, ga4Payload, moneyFrom, type PrevRow,
} from "../_shared/attribution.ts"

const row = (canonical_state: PrevRow["canonical_state"], expires_at: string | null = "2026-11-01T00:00:00.000Z"): PrevRow =>
  ({ canonical_state, expires_at })

Deno.test("a new row is a trial start or a purchase; pending converting counts the same", () => {
  assertEquals(detectTransition(null, { canonicalState: "trial", expiresAt: null }), { kind: "trial_start", periodKey: "" })
  assertEquals(detectTransition(null, { canonicalState: "active", expiresAt: null }), { kind: "purchase", periodKey: "" })
  assertEquals(detectTransition(row("pending"), { canonicalState: "active_non_renewing", expiresAt: null }), { kind: "purchase", periodKey: "" })
  assertEquals(detectTransition(null, { canonicalState: "pending", expiresAt: null }), null)
  assertEquals(detectTransition(null, { canonicalState: "expired", expiresAt: null }), null)
})

Deno.test("a trial converting to paid is the first purchase", () => {
  assertEquals(detectTransition(row("trial"), { canonicalState: "active", expiresAt: "2026-12-01T00:00:00.000Z" }), { kind: "purchase", periodKey: "" })
})

Deno.test("a renewal is expires_at moving forward while paid, keyed by the new period", () => {
  const next = { canonicalState: "active" as const, expiresAt: "2026-12-01T00:00:00.000Z" }
  assertEquals(detectTransition(row("active"), next), { kind: "renewal", periodKey: next.expiresAt })
  assertEquals(detectTransition(row("on_billing_retry"), next), { kind: "renewal", periodKey: next.expiresAt }, "recovered from retry")
  assertEquals(detectTransition(row("active"), { canonicalState: "active_non_renewing", expiresAt: "2026-11-01T00:00:00.000Z" }), null, "cancel: same period")
  assertEquals(detectTransition(row("active"), { canonicalState: "active", expiresAt: "2026-10-01T00:00:00.000Z" }), null, "never backwards")
  assertEquals(detectTransition(row("active"), { canonicalState: "in_grace_period", expiresAt: "2026-11-01T00:00:00.000Z" }), null)
})

Deno.test("a refund fires once; a lapsed subscription coming back is a purchase of that period", () => {
  assertEquals(detectTransition(row("active"), { canonicalState: "refunded", expiresAt: null }), { kind: "refund", periodKey: "" })
  assertEquals(detectTransition(row("refunded"), { canonicalState: "refunded", expiresAt: null }), null)
  assertEquals(
    detectTransition(row("expired"), { canonicalState: "active", expiresAt: "2027-01-01T00:00:00.000Z" }),
    { kind: "purchase", periodKey: "2027-01-01T00:00:00.000Z" },
  )
  assertEquals(detectTransition(row("active"), { canonicalState: "expired", expiresAt: null }), null)
})

Deno.test("price: catalogue price when known, nothing (not zero) when not", () => {
  assertEquals(moneyFrom({ base_price_cents: 499, base_currency: "usd" }), { value: 4.99, currency: "USD" })
  assertEquals(moneyFrom({ base_price_cents: 0, base_currency: "USD" }), null)
  assertEquals(moneyFrom(null), null)
})

Deno.test("GA4 Measurement Protocol body: app_instance_id + a GA4 event, value only when priced", () => {
  const priced = ga4Payload("renewal", "inst-1", { transactionId: "t1", productId: "pro.monthly", money: { value: 4.99, currency: "USD" } })
  assertEquals(priced, {
    app_instance_id: "inst-1",
    events: [{
      name: "subscription_renew",
      params: { transaction_id: "t1", item_id: "pro.monthly", value: 4.99, currency: "USD", items: [{ item_id: "pro.monthly", quantity: 1, price: 4.99 }] },
    }],
  })
  const trial = ga4Payload("trial_start", "inst-1", { transactionId: "t2", productId: "pro", money: null }) as any
  assertEquals(trial.events[0].name, "start_trial")
  assert(!("value" in trial.events[0].params) && !("currency" in trial.events[0].params))
  assertEquals((ga4Payload("refund", "i", { transactionId: "t", productId: "p", money: null }) as any).events[0].name, "refund")
  assertEquals((ga4Payload("purchase", "i", { transactionId: "t", productId: "p", money: null }) as any).events[0].name, "purchase")
})

Deno.test("AppsFlyer S2S body: appsflyer_id, af_* event, revenue as a string, refunds negative", () => {
  const at = new Date("2026-11-23T10:11:12.345Z")
  assertEquals(afEventTime(at), "2026-11-23 10:11:12.345")
  assertEquals(appsFlyerPayload("purchase", "af-1", { transactionId: "t1", productId: "pro", money: { value: 9.99, currency: "INR" }, at }), {
    appsflyer_id: "af-1",
    eventName: "af_subscribe",
    eventValue: { af_order_id: "t1", af_content_id: "pro", af_revenue: "9.99" },
    eventTime: "2026-11-23 10:11:12.345",
    af_events_api: "true",
    eventCurrency: "INR",
  })
  const refund = appsFlyerPayload("refund", "af-1", { transactionId: "t1", productId: "pro", money: { value: 9.99, currency: "INR" }, at }) as any
  assertEquals(refund.eventName, "af_refund")
  assertEquals(refund.eventValue.af_revenue, "-9.99")
  const unpriced = appsFlyerPayload("trial_start", "af-1", { transactionId: "t", productId: "p", money: null, at }) as any
  assertEquals(unpriced.eventName, "af_start_trial")
  assert(!("af_revenue" in unpriced.eventValue) && !("eventCurrency" in unpriced))
})

Deno.test("the forwarded transaction id is stable, short and distinct per event", async () => {
  const a = await forwardTxnId("google_play", "x".repeat(200), "renewal", "2026-12-01T00:00:00.000Z")
  assertEquals(a.length, 32)
  assertEquals(a, await forwardTxnId("google_play", "x".repeat(200), "renewal", "2026-12-01T00:00:00.000Z"))
  assert(a !== await forwardTxnId("google_play", "x".repeat(200), "renewal", "2027-01-01T00:00:00.000Z"))
})

Deno.test("the sender never throws into the webhook path and skips sandbox / untenanted events", async () => {
  let calls = 0
  const boom = { rpc: () => { calls++; throw new Error("db down") }, from: () => { calls++; throw new Error("db down") } }
  const ev = { tenantId: "t1", provider: "google_play", productId: "p", stableTxnId: "tok", appUserId: "u", isSandbox: false }
  await forwardLifecycle(boom, ev, { kind: "purchase", periodKey: "" }) // must resolve
  assertEquals(calls, 1)
  await forwardLifecycle(boom, { ...ev, isSandbox: true }, { kind: "purchase", periodKey: "" })
  await forwardLifecycle(boom, { ...ev, tenantId: null }, { kind: "purchase", periodKey: "" })
  assertEquals(calls, 1, "sandbox and self-hosted events never touch the forwarder")
})
