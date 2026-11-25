// attempt-stitch (paycraft-attempt-observability D1 / D7): attempts written by OLD writers (no attempt_id —
// 186's web webhooks, 188/201's store reports) are labelled `correlation = inferred` with the provider key
// rule that identified them; a row the SDK named (`exact`) is never touched; then the SQL engine
// (attempt_stitch_run) flags provider-paid-but-not-granted after 10 minutes and times out silent checkouts,
// on the clock the caller passes. The SQL half is asserted in supabase/tests/210_payment_attempts_test.sql.
// Run: deno test -A supabase/functions/__tests__/attempt-stitch.test.ts
import { assert, assertEquals, assertMatch } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  inferredAttemptId,
  matchAppStoreLegacy,
  matchCashfreeLegacy,
  matchPlayLegacy,
  matchRazorpayLegacy,
  matchStripeLegacy,
  stitchMatch,
} from "../attempt-stitch/match.ts"
import { parseStitchClock, stitchOnce } from "../attempt-stitch/stitch.ts"
import { FakeAttemptDb } from "./_fake-attempt-db.ts"

Deno.test("Stripe legacy: a cs_* session or pi_* intent is identified by its own id", () => {
  assertEquals(matchStripeLegacy({ provider: "stripe", provider_session_id: "cs_test_1" }), { match_rule: "stripe_session_id" })
  assertEquals(matchStripeLegacy({ provider: "stripe", provider_session_id: "pi_3Nabc" }), { match_rule: "stripe_payment_intent" })
  assertEquals(matchStripeLegacy({ provider: "stripe", provider_session_id: "random" }), null)
})

Deno.test("Razorpay legacy: subscription, payment and payment-link ids by prefix", () => {
  assertEquals(matchRazorpayLegacy({ provider: "razorpay", provider_session_id: "sub_abc" }), { match_rule: "razorpay_subscription_id" })
  assertEquals(matchRazorpayLegacy({ provider: "razorpay", provider_session_id: "pay_abc" }), { match_rule: "razorpay_payment_id" })
  assertEquals(matchRazorpayLegacy({ provider: "razorpay", provider_session_id: "plink_abc" }), { match_rule: "razorpay_payment_link_id" })
  assertEquals(matchRazorpayLegacy({ provider: "razorpay", provider_session_id: "order_x" }), null)
  assertEquals(matchCashfreeLegacy({ provider: "cashfree", provider_session_id: "order_123" }), { match_rule: "cashfree_order_id" })
})

Deno.test("Play / App Store legacy: the SDK's own attempt id (188 keys store reports on it), else the store's key", () => {
  assertEquals(matchPlayLegacy({ provider: "google_play", provider_session_id: "1732492800000-9f3c2a1b" }), { match_rule: "sdk_store_attempt_id" })
  assertEquals(matchPlayLegacy({ provider: "google_play", provider_session_id: "token123" }), { match_rule: "play_purchase_token" })
  assertEquals(matchAppStoreLegacy({ provider: "app_store", provider_session_id: "100000012345" }), { match_rule: "appstore_original_transaction_id" })
  assertEquals(matchAppStoreLegacy({ provider: "app_store", provider_session_id: "1732492800000-ab12" }), { match_rule: "sdk_store_attempt_id" })
  assertEquals(stitchMatch({ provider: "paypal", provider_session_id: "x" }), null)
})

Deno.test("inferred ids: deterministic, short, never shaped like an SDK id", async () => {
  const a = await inferredAttemptId("google_play", "t".repeat(400))
  assertEquals(a, await inferredAttemptId("google_play", "t".repeat(400)))
  assertMatch(a, /^inf-google_play-[0-9a-f]{32}$/)
  assert(a !== await inferredAttemptId("google_play", "u".repeat(400)))
})

Deno.test("stitchOnce labels legacy rows inferred + match_rule and leaves an exact row alone", async () => {
  const db = new FakeAttemptDb()
  db.seed("checkout_attempts", { tenant_id: "t1", provider: "stripe", provider_session_id: "cs_1", state: "abandoned", attempt_id: null, correlation: null, match_rule: null })
  db.seed("checkout_attempts", { tenant_id: "t1", provider: "google_play", provider_session_id: "1732492800000-9f3c", state: "abandoned", attempt_id: null, correlation: null, match_rule: null })
  db.seed("checkout_attempts", { tenant_id: "t1", provider: "paypal", provider_session_id: "x-1", state: "failed", attempt_id: null, correlation: null, match_rule: null })
  const exact = db.seed("checkout_attempts", { tenant_id: "t1", provider: "stripe", provider_session_id: "cs_2", state: "checkout_opened", attempt_id: "att-exact", correlation: "exact", match_rule: null })

  const r = await stitchOnce(db, new Date("2026-11-25T00:00:00Z"))
  assertEquals(r.stitched, 2)
  assertEquals(r.unmatched, 1)

  const stripe = db.tables.checkout_attempts.find((x) => x.provider_session_id === "cs_1")!
  assertEquals(stripe.correlation, "inferred")
  assertEquals(stripe.match_rule, "stripe_session_id")
  assertMatch(String(stripe.attempt_id), /^inf-stripe-/)
  const play = db.tables.checkout_attempts.find((x) => x.provider === "google_play")!
  assertEquals(play.attempt_id, "1732492800000-9f3c", "a store report is joined to the SDK's own id")
  assertEquals(play.match_rule, "sdk_store_attempt_id")
  const paypal = db.tables.checkout_attempts.find((x) => x.provider === "paypal")!
  assertEquals(paypal.correlation, null, "an unmatched row stays uncorrelated")
  assertEquals(paypal.match_rule, "none", "…and is not re-examined every run")

  assertEquals(exact.correlation, "exact")
  assertEquals(exact.match_rule, null)
  const updates = db.log.filter((w) => w.table === "checkout_attempts" && w.op === "update")
  assert(updates.length >= 3)
  assert(updates.every((u) => u.filters.includes("correlation is null")), "every stitch write filters out exact rows")
  assertEquals(db.events(String(stripe.attempt_id))[0]?.event, "stitched:stripe_session_id")

  // A second run finds nothing left to do.
  const again = await stitchOnce(db, new Date("2026-11-25T00:05:00Z"))
  assertEquals(again.stitched + again.unmatched, 0)
})

Deno.test("an inferred SDK id already held by an exact attempt falls back to a derived id, never a clash", async () => {
  const db = new FakeAttemptDb()
  db.seed("checkout_attempts", { tenant_id: "t1", provider: "app_store", provider_session_id: "attempt:1732492800000-aa", state: "granted", attempt_id: "1732492800000-aa", correlation: "exact" })
  db.seed("checkout_attempts", { tenant_id: "t1", provider: "google_play", provider_session_id: "1732492800000-aa", state: "abandoned", attempt_id: null, correlation: null, match_rule: null })
  const r = await stitchOnce(db, new Date("2026-11-25T00:00:00Z"))
  assertEquals(r.stitched, 1)
  const legacy = db.tables.checkout_attempts.find((x) => x.provider === "google_play")!
  assertMatch(String(legacy.attempt_id), /^inf-google_play-[0-9a-f]{32}$/)
})

Deno.test("paid_not_granted / abandon timeout run in SQL on the injected clock with the 10-minute cutoff", async () => {
  const db = new FakeAttemptDb()
  const r = await stitchOnce(db, new Date("2026-11-25T00:10:00Z"))
  assertEquals(db.rpcCalls.length, 1)
  assertEquals(db.rpcCalls[0].fn, "attempt_stitch_run")
  assertEquals(db.rpcCalls[0].params.p_now, "2026-11-25T00:10:00.000Z")
  assertEquals(db.rpcCalls[0].params.p_paid_cutoff_minutes, 10)
  assertEquals(db.rpcCalls[0].params.p_abandon_minutes, 120)
  assertEquals(r.paid_not_granted, 0)
})

Deno.test("the clock override: ?now=ISO is honoured, anything else is refused", () => {
  const fallback = new Date("2026-01-01T00:00:00Z")
  assertEquals(parseStitchClock(null, fallback), fallback)
  assertEquals(parseStitchClock("2026-11-25T00:10:00Z", fallback)?.toISOString(), "2026-11-25T00:10:00.000Z")
  assertEquals(parseStitchClock("not-a-date", fallback), null)
})
