// Store subscription states → what the app unlocks. Every Apple notification (renewal failed, price increase,
// grace, refund, …) and every Play RTDN is handled by RE-FETCHING the store's status and mapping it here, so these
// two mappers decide whether a lapsed, retrying, paused or refunded subscriber still gets premium.
// Premium = trial | active | active_non_renewing | in_grace_period (migration 203); everything else is locked.
// Run: SUPABASE_URL=http://x SUPABASE_SERVICE_ROLE_KEY=x deno test --no-check --allow-env supabase/functions/__tests__/store-state-mapping.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { appleToCanonical, googleToCanonical } from "../_shared/entitlement-reconcile.ts"

const jws = (payload: Record<string, unknown>) =>
  `h.${btoa(JSON.stringify(payload)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}.s`

const PREMIUM = new Set(["trial", "active", "active_non_renewing", "in_grace_period"])
const HOUR = 3600e3

function apple(status: number, opts: { autoRenew?: number; offerType?: number; grace?: number } = {}) {
  const statuses = {
    data: [{
      lastTransactions: [{
        originalTransactionId: "otx",
        status,
        signedTransactionInfo: jws({
          productId: "pro.monthly", appAccountToken: "u-1", expiresDate: Date.now() + HOUR,
          offerType: opts.offerType, signedDate: Date.now(), environment: "Production",
        }),
        signedRenewalInfo: jws({ autoRenewStatus: opts.autoRenew ?? 1, gracePeriodExpiresDate: opts.grace }),
      }],
    }],
  }
  return appleToCanonical(statuses, "otx")
}

Deno.test("Apple: every subscription status maps to the right access", () => {
  const cases: Array<[string, ReturnType<typeof apple>, string, boolean]> = [
    ["active, renewing", apple(1), "active", true],
    ["active, auto-renew off (cancelled, still paid up)", apple(1, { autoRenew: 0 }), "active_non_renewing", true],
    ["free trial", apple(1, { offerType: 1 }), "trial", true],
    ["expired", apple(2), "expired", false],
    // DID_FAIL_TO_RENEW without a grace period lands here: access suspended until billing recovers.
    ["billing retry", apple(3), "on_billing_retry", false],
    // DID_FAIL_TO_RENEW with Billing Grace Period on: the subscriber keeps access until the grace date.
    ["billing grace period", apple(4, { grace: Date.now() + HOUR }), "in_grace_period", true],
    // REFUND / REVOKE (incl. Family Sharing removal).
    ["revoked", apple(5), "refunded", false],
  ]
  for (const [label, ev, state, premium] of cases) {
    assertEquals(ev.canonicalState, state, label)
    assertEquals(PREMIUM.has(ev.canonicalState), premium, label)
  }
  const grace = apple(4, { grace: 1_900_000_000_000 })
  assertEquals(grace.inGraceUntil, new Date(1_900_000_000_000).toISOString(), "grace keeps access until Apple's date")
  assertEquals(apple(3).willRenew, false)
})

function play(state: string, opts: { autoRenew?: boolean; expiresInMs?: number } = {}) {
  return googleToCanonical({
    subscriptionState: state,
    lineItems: [{
      productId: "pro_monthly",
      expiryTime: new Date(Date.now() + (opts.expiresInMs ?? HOUR)).toISOString(),
      autoRenewingPlan: { autoRenewEnabled: opts.autoRenew ?? true },
    }],
  }, "token", "u-1")
}

Deno.test("Google Play: every subscription state maps to the right access", () => {
  const cases: Array<[string, ReturnType<typeof play>, string, boolean]> = [
    ["active", play("SUBSCRIPTION_STATE_ACTIVE"), "active", true],
    ["active, auto-renew off", play("SUBSCRIPTION_STATE_ACTIVE", { autoRenew: false }), "active_non_renewing", true],
    ["grace period", play("SUBSCRIPTION_STATE_IN_GRACE_PERIOD"), "in_grace_period", true],
    ["account hold", play("SUBSCRIPTION_STATE_ON_HOLD"), "on_billing_retry", false],
    ["paused", play("SUBSCRIPTION_STATE_PAUSED"), "paused", false],
    ["cancelled, still inside the paid period", play("SUBSCRIPTION_STATE_CANCELED"), "active_non_renewing", true],
    ["cancelled, period over", play("SUBSCRIPTION_STATE_CANCELED", { expiresInMs: -HOUR }), "cancelled", false],
    ["expired", play("SUBSCRIPTION_STATE_EXPIRED", { expiresInMs: -HOUR }), "expired", false],
    ["pending payment", play("SUBSCRIPTION_STATE_PENDING"), "pending", false],
  ]
  for (const [label, ev, state, premium] of cases) {
    assertEquals(ev.canonicalState, state, label)
    assertEquals(PREMIUM.has(ev.canonicalState), premium, label)
  }
  assertEquals(play("SUBSCRIPTION_STATE_IN_GRACE_PERIOD").inGraceUntil !== null, true)
  assertEquals(play("SUBSCRIPTION_STATE_ON_HOLD").willRenew, false)
})
