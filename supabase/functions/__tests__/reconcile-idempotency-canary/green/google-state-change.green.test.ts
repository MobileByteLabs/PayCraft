// supabase/functions/__tests__/reconcile-idempotency-canary/green/google-state-change.green.test.ts
// GREEN — a Play cancellation must update the record even though the expiry time did not move.
//
// Device finding 2026-10-31: a test subscription was cancelled in Play; Google reported
// SUBSCRIPTION_STATE_CANCELED with the SAME expiryTime, and the record stayed `active,
// will_renew=true`. googleToCanonical stamped latestEventTs = expiryTime, and the reconcile keeps
// only STRICTLY newer events — so every cancel / refund / revoke / expiry was dropped; only a
// renewal (which moves the expiry) ever landed. The mapper's input is always a fresh authoritative
// re-fetch, so its event time is the time that truth was read.
import "./_setup.ts"; // sets SUPABASE_* env — MUST precede the reconcile-module import
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { googleToCanonical, reconcileEntitlement } from "../../../_shared/entitlement-reconcile.ts";
import { latestState } from "./harness.ts";

const expiry = new Date(Date.now() + 3 * 60_000).toISOString(); // still inside the paid period
const line = { productId: "cappy.sub.week", expiryTime: expiry };

Deno.test("GREEN: cancelling (same expiryTime) updates active → active_non_renewing", async () => {
  await reconcileEntitlement(googleToCanonical(
    { subscriptionState: "SUBSCRIPTION_STATE_ACTIVE", lineItems: [{ ...line, autoRenewingPlan: { autoRenewEnabled: true } }] },
    "tok-cancel-1",
    "device-a",
  ));
  assertEquals(await latestState("google_play", "tok-cancel-1"), "active");

  await new Promise((r) => setTimeout(r, 5)); // a later read of Google's truth
  await reconcileEntitlement(googleToCanonical(
    { subscriptionState: "SUBSCRIPTION_STATE_CANCELED", lineItems: [{ ...line, autoRenewingPlan: { autoRenewEnabled: false } }] },
    "tok-cancel-1",
    "device-a",
  ));

  assertEquals(await latestState("google_play", "tok-cancel-1"), "active_non_renewing");
});
