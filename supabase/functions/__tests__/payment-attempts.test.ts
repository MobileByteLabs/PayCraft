// _shared/payment-attempts.ts — the one door every function uses to open, move and close a purchase attempt
// (migration 210, paycraft-attempt-observability GOAL D1 / D5 / D6). Resolvers read the attempt id back from
// what each provider echoes; the state helpers ride the same edge table the migration's guard enforces;
// every failure lands with a stage, a class, a code and a message of at most 200 characters.
// Run: deno test -A supabase/functions/__tests__/payment-attempts.test.ts
import { assert, assertEquals, assertFalse, assertRejects } from "https://deno.land/std@0.224.0/assert/mod.ts"
import {
  ATTEMPT_STATES,
  canTransition,
  closeAsAbandoned,
  closeAsFailed,
  closeAsGranted,
  mapAppStoreTxnToAttempt,
  mapPlayTokenToAttempt,
  normaliseAttemptId,
  openAttempt,
  resolveAttemptIdForAppStoreTxn,
  resolveAttemptIdForPlayToken,
  resolveAttemptIdFromCashfree,
  resolveAttemptIdFromPlay,
  resolveAttemptIdFromRazorpay,
  resolveAttemptIdFromRazorpayEvent,
  resolveAttemptIdFromStripe,
  sanitiseCode,
  sanitiseMessage,
  transitionAttempt,
} from "../_shared/payment-attempts.ts"
import { FakeAttemptDb } from "./_fake-attempt-db.ts"

Deno.test("Stripe: metadata.attempt_id preferred, client_reference_id as fallback", () => {
  assertEquals(resolveAttemptIdFromStripe({ metadata: { attempt_id: "att-1" }, client_reference_id: "att-2" }), "att-1")
  assertEquals(resolveAttemptIdFromStripe({ metadata: {}, client_reference_id: "att-2" }), "att-2")
  assertEquals(resolveAttemptIdFromStripe({ metadata: {}, client_reference_id: null }), null)
  assertEquals(resolveAttemptIdFromStripe({ metadata: { attempt_id: "bad id with spaces" } }), null)
  assertEquals(resolveAttemptIdFromStripe(null), null)
})

Deno.test("Razorpay: notes.attempt_id on the subscription, payment or payment-link entity", () => {
  assertEquals(resolveAttemptIdFromRazorpay({ notes: { attempt_id: "att-r1" } }), "att-r1")
  assertEquals(resolveAttemptIdFromRazorpay({}), null)
  assertEquals(resolveAttemptIdFromRazorpay({ notes: [] }), null) // Razorpay sends [] for "no notes"
  assertEquals(resolveAttemptIdFromRazorpayEvent({ subscription: { entity: { notes: { attempt_id: "att-sub" } } } }), "att-sub")
  assertEquals(resolveAttemptIdFromRazorpayEvent({ payment: { entity: { notes: { attempt_id: "att-pay" } } } }), "att-pay")
  assertEquals(resolveAttemptIdFromRazorpayEvent({ payment_link: { entity: { notes: { attempt_id: "att-pl" } } } }), "att-pl")
  assertEquals(resolveAttemptIdFromRazorpayEvent({}), null)
})

Deno.test("Cashfree: order.order_tags.paycraft_attempt_id", () => {
  assertEquals(resolveAttemptIdFromCashfree({ order: { order_tags: { paycraft_attempt_id: "att-cf" } } }), "att-cf")
  assertEquals(resolveAttemptIdFromCashfree({ order: { order_tags: null } }), null)
  assertEquals(resolveAttemptIdFromCashfree(undefined), null)
})

Deno.test("Play: obfuscatedExternalProfileId is the attempt id (obfuscatedExternalAccountId stays the user)", () => {
  assertEquals(resolveAttemptIdFromPlay({ externalAccountIdentifiers:
    { obfuscatedExternalProfileId: "att-p1", obfuscatedExternalAccountId: "user-hash" } }), "att-p1")
  assertEquals(resolveAttemptIdFromPlay({ externalAccountIdentifiers: { obfuscatedExternalAccountId: "u" } }), null)
  assertEquals(resolveAttemptIdFromPlay(null), null)
})

Deno.test("attempt ids: the SDK's att-<uuid> and millis-hex shapes pass; anything else is refused", () => {
  assertEquals(normaliseAttemptId("att-0f8e6b1a-1c2d-4e5f-8a9b-0c1d2e3f4a5b"), "att-0f8e6b1a-1c2d-4e5f-8a9b-0c1d2e3f4a5b")
  assertEquals(normaliseAttemptId("1732492800000-9f3c2a1b7d"), "1732492800000-9f3c2a1b7d")
  assertEquals(normaliseAttemptId(""), null)
  assertEquals(normaliseAttemptId("x".repeat(101)), null)
  assertEquals(normaliseAttemptId("att 1"), null)
  assertEquals(normaliseAttemptId("<script>"), null)
  assertEquals(normaliseAttemptId(42), null)
})

Deno.test("sanitiseMessage: strips emails + tokens, truncates to 200 chars; sanitiseCode keeps a short slug", () => {
  assertEquals(sanitiseMessage("card declined by issuer"), "card declined by issuer")
  assertEquals(sanitiseMessage("user foo@bar.test declined"), "user [email] declined")
  assertEquals(sanitiseMessage("Bearer pk_live_abcd1234efgh5678"), "Bearer [token]")
  assertEquals(sanitiseMessage("key sk_test_51Habcdefghij failed"), "key [token] failed")
  assertEquals(sanitiseMessage("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefghij leaked"), "jwt [token] leaked")
  assertEquals((sanitiseMessage("x".repeat(400)) ?? "").length, 200)
  assertEquals(sanitiseMessage(null), null)
  assertEquals(sanitiseMessage(""), null)
  assertEquals(sanitiseMessage("   "), null)
  assertEquals(sanitiseCode("Do Not Honor!"), "do_not_honor")
  assertEquals(sanitiseCode(402), "402")
  assertEquals((sanitiseCode("a".repeat(80)) ?? "").length, 48)
  assertEquals(sanitiseCode(null), null)
})

Deno.test("canTransition mirrors the migration 210 guard exactly", () => {
  const legal = new Set([
    "started>checkout_opened", "started>provider_result", "started>abandoned", "started>failed",
    "checkout_opened>provider_result", "checkout_opened>abandoned", "checkout_opened>failed",
    "provider_result>granted", "provider_result>failed", "provider_result>paid_not_granted",
    "abandoned>provider_result", "failed>provider_result",
    "abandoned>granted", "failed>granted", "paid_not_granted>granted",
  ])
  for (const from of ATTEMPT_STATES) {
    for (const to of ATTEMPT_STATES) {
      if (from === to) continue
      assertEquals(canTransition(from, to), legal.has(`${from}>${to}`), `${from} → ${to}`)
    }
  }
})

Deno.test("state machine: open → checkout_opened → provider_result → granted; replays are no-ops", async () => {
  const db = new FakeAttemptDb()
  assert(await openAttempt(db, { attempt_id: "att-u", tenant_id: "t1", provider: "stripe", mode: "live", email: "A@B.test", plan: "pro-monthly" }))
  assertEquals(db.attempt("att-u")?.state, "started")
  assertEquals(db.attempt("att-u")?.correlation, "exact")
  assertEquals(db.attempt("att-u")?.email, "a@b.test")
  assertFalse(await openAttempt(db, { attempt_id: "att-u", tenant_id: "t1", provider: "stripe", mode: "live", email: "a@b.test" }), "a second open is a no-op")

  assert(await transitionAttempt(db, "att-u", "checkout_opened", { provider_session_id: "cs_1" }))
  assert(await transitionAttempt(db, "att-u", "provider_result", { paid_at: "2026-11-25T00:00:00.000Z" }))
  assertFalse(await transitionAttempt(db, "att-u", "provider_result", { paid_at: "2026-11-25T00:05:00.000Z" }), "webhook redelivery")
  assertEquals(db.attempt("att-u")?.paid_at, "2026-11-25T00:00:00.000Z", "a replay must not move paid_at")
  assert(await closeAsGranted(db, "att-u", new Date("2026-11-25T00:00:02Z")))
  assertEquals(db.attempt("att-u")?.state, "granted")
  assertEquals(db.attempt("att-u")?.granted_at, "2026-11-25T00:00:02.000Z")
  assertEquals(db.attempt("att-u")?.closed_at, "2026-11-25T00:00:02.000Z")
  assertFalse(await closeAsGranted(db, "att-u"), "granted is terminal — a second grant changes nothing")
  assertFalse(await transitionAttempt(db, "att-u", "failed"), "the guard's refusal is reported, not thrown")
  assertFalse(await transitionAttempt(db, "att-missing", "checkout_opened"), "an unknown id changes nothing")
  await assertRejects(
    () => openAttempt(db, { attempt_id: "att-anon", tenant_id: "t1", provider: "stripe", mode: "live" }),
    Error,
    "an email or an app_user_id is required",
  )
})

Deno.test("closeAsGranted from an open checkout records the implied provider result first", async () => {
  const db = new FakeAttemptDb()
  await openAttempt(db, { attempt_id: "att-g", tenant_id: "t1", provider: "razorpay", mode: "test", app_user_id: "u-1" })
  await transitionAttempt(db, "att-g", "checkout_opened")
  assert(await closeAsGranted(db, "att-g", new Date("2026-11-25T01:00:00Z")))
  const states = db.log.filter((w) => w.table === "checkout_attempts" && w.op === "update").map((w) => w.payload.state)
  assertEquals(states, ["checkout_opened", "provider_result", "granted"])
  assertEquals(db.attempt("att-g")?.paid_at, "2026-11-25T01:00:00.000Z")
})

Deno.test("a late grant after an abandon timeout or a failure is accepted", async () => {
  const db = new FakeAttemptDb()
  await openAttempt(db, { attempt_id: "att-late", tenant_id: "t1", provider: "stripe", mode: "live", app_user_id: "u-1" })
  await transitionAttempt(db, "att-late", "checkout_opened")
  assert(await closeAsAbandoned(db, "att-late", { stage: "server", error_class: "abandon_timeout", error_code: "no_result_120m" }))
  assertEquals(db.attempt("att-late")?.outcome, "abandoned")
  assert(await closeAsGranted(db, "att-late"))
  assertEquals(db.attempt("att-late")?.state, "granted")
})

Deno.test("failures at server, webhook and entitlement each carry stage, class, code and a ≤ 200-char message", async () => {
  const db = new FakeAttemptDb()
  const long = "Stripe said: " + "the card was declined by the issuing bank for buyer jane@doe.test ".repeat(6)
  for (const [id, stage, cls, code] of [
    ["att-s", "server", "stripe_init", 502],
    ["att-w", "webhook", "stripe_webhook", "processing_error"],
    ["att-e", "entitlement", "reconcile_failed", "upsert"],
  ] as const) {
    await openAttempt(db, { attempt_id: id, tenant_id: "t1", provider: "stripe", mode: "live", app_user_id: "u-1" })
    assert(await closeAsFailed(db, id, { stage, error_class: cls, error_code: code, error_message: long }))
    const row = db.attempt(id)!
    assertEquals(row.state, "failed")
    assertEquals(row.outcome, "payment_failed")
    assertEquals(row.stage, stage)
    assertEquals(row.error_class, cls)
    assertEquals(row.error_code, sanitiseCode(code))
    assert(typeof row.error_message === "string" && row.error_message.length <= 200, "message bounded")
    assertFalse(String(row.error_message).includes("jane@doe.test"), "no email in a failure message")
    assert(row.closed_at, "a failure closes the attempt")
  }
})

Deno.test("a failure on an attempt that cannot move (already granted) is kept on the timeline, never lost", async () => {
  const db = new FakeAttemptDb()
  await openAttempt(db, { attempt_id: "att-k", tenant_id: "t9", provider: "stripe", mode: "live", app_user_id: "u-1" })
  await transitionAttempt(db, "att-k", "provider_result", { paid_at: new Date().toISOString() })
  await closeAsGranted(db, "att-k")
  assertFalse(await closeAsFailed(db, "att-k", { stage: "webhook", error_class: "stripe_webhook", error_code: null, error_message: "late duplicate failed" }))
  assertEquals(db.attempt("att-k")?.state, "granted")
  const ev = db.events("att-k").find((e) => e.event === "failure")
  assert(ev, "the failure is appended to the timeline")
  assertEquals(ev.tenant_id, "t9")
  assertEquals(ev.stage, "webhook")
  assertEquals(ev.error_class, "stripe_webhook")
  assertEquals(ev.error_message, "late duplicate failed")
})

Deno.test("App Store + Play maps: register writes, the notification reads back the same attempt", async () => {
  const db = new FakeAttemptDb()
  await mapAppStoreTxnToAttempt(db, "t1", "100000012345", "att-ios")
  await mapAppStoreTxnToAttempt(db, "t1", "100000012345", "att-ios") // client retry: same row
  assertEquals(db.tables.appstore_txn_attempt_map.length, 1)
  assertEquals(await resolveAttemptIdForAppStoreTxn(db, "100000012345"), "att-ios")
  assertEquals(await resolveAttemptIdForAppStoreTxn(db, "999"), null)

  await mapPlayTokenToAttempt(db, "t1", "tok-abc", "att-play")
  assertEquals(await resolveAttemptIdForPlayToken(db, "tok-abc"), "att-play")
  assertEquals(await resolveAttemptIdForPlayToken(db, "tok-other"), null)
})

Deno.test("a provider's expired / declined report (recordAttempt) closes the echoed attempt; old callers are unchanged", async () => {
  const { recordAttempt } = await import("../_shared/checkout-attempts.ts")
  const db = new FakeAttemptDb()
  await openAttempt(db, { attempt_id: "att-x", tenant_id: "t1", provider: "stripe", mode: "live", email: "b@x.test", provider_session_id: "cs_x", state: "checkout_opened" })
  const row = { tenant_id: "t1", provider: "stripe", mode: "live" as const, email: "b@x.test", plan: "pro-monthly", outcome: "abandoned" as const, provider_session_id: "cs_x" }
  await recordAttempt(db, row, { attemptId: "att-x" })
  assertEquals(db.tables.checkout_attempts.length, 1, "the report merges into the attempt's own row")
  assertEquals(db.attempt("att-x")?.state, "abandoned")
  assertEquals(db.attempt("att-x")?.stage, "provider")
  assertEquals(db.attempt("att-x")?.error_class, "stripe_abandoned")

  await openAttempt(db, { attempt_id: "att-y", tenant_id: "t1", provider: "razorpay", mode: "live", email: "c@x.test", state: "checkout_opened" })
  await recordAttempt(db, { ...row, provider: "razorpay", email: "c@x.test", outcome: "payment_failed", provider_session_id: "pay_1" },
    { attemptId: "att-y", errorCode: "BAD_REQUEST_ERROR", errorMessage: "Payment failed for c@x.test" })
  assertEquals(db.attempt("att-y")?.state, "failed")
  assertEquals(db.attempt("att-y")?.error_code, "bad_request_error")
  assertEquals(db.attempt("att-y")?.error_message, "Payment failed for [email]")

  await recordAttempt(db, { ...row, email: "d@x.test", provider_session_id: "cs_legacy" })
  const legacy = db.tables.checkout_attempts.find((r) => r.provider_session_id === "cs_legacy")
  assertEquals(legacy?.attempt_id, undefined, "a 186 caller with no context writes exactly the old row")
})

Deno.test("open adopts the row an old writer made for the same attempt (188 keys store attempts on the SDK id)", async () => {
  const { recordAttemptFailure } = await import("../_shared/payment-attempts.ts")
  const db = new FakeAttemptDb()
  db.seed("checkout_attempts", {
    tenant_id: "t1", provider: "google_play", mode: "live", app_user_id: "u", outcome: "abandoned",
    provider_session_id: "1732492800000-9f3c", state: "abandoned", attempt_id: null, correlation: null,
  })
  assert(await openAttempt(db, { attempt_id: "1732492800000-9f3c", tenant_id: "t1", provider: "google_play", mode: "live", app_user_id: "u" }))
  assertEquals(db.tables.checkout_attempts.length, 1, "no second row")
  assertEquals(db.attempt("1732492800000-9f3c")?.correlation, "exact")
  assert(await transitionAttempt(db, "1732492800000-9f3c", "provider_result", { paid_at: new Date().toISOString() }), "abandoned → provider_result")
  assert(await closeAsGranted(db, "1732492800000-9f3c"))

  // A failure for an attempt nobody opened is still kept, under the caller's tenant.
  assertFalse(await recordAttemptFailure(db, "att-never-opened", "t2", { stage: "server", error_class: "register_play", error_code: "play_api_404", error_message: "subscriptionsv2.get failed (404)" }))
  const ev = db.events("att-never-opened")
  assertEquals(ev.length, 1)
  assertEquals(ev[0].tenant_id, "t2")
  assertEquals(ev[0].error_code, "play_api_404")
})
