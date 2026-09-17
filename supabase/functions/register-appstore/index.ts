// supabase/functions/register-appstore/index.ts
//
// Client-facing grant endpoint for the StoreKit lane — the Apple mirror of register-play-purchase.
//
// WHY THIS EXISTS (audit SK-4). Google Play had a client-facing grant endpoint; StoreKit did not.
// The iOS SDK therefore had to rely on Apple's App Store Server Notification (ASSN-V2) arriving
// before the client's own reconcile read. In practice the client usually WINS that race, so the
// buyer completed a purchase, the SDK read a not-yet-updated entitlement, and the paywall came
// straight back up — with their money already taken. This endpoint removes the race: the client
// posts the signed transaction, the server establishes truth synchronously, and premium unlocks on
// the response. ASSN-V2 keeps running as the authoritative async channel for everything afterwards
// (renewals, refunds, revocations); the two are idempotent against the same canonical record.
//
// The client body is NEVER trusted. It is used only to identify WHICH subscription to ask Apple
// about; every field that decides entitlement comes from Apple:
//   1. cryptographically verify the client's signed transaction JWS (x5c chain pinned to Apple
//      Root CA - G3, ES256 signature) — a forged receipt cannot get past this;
//   2. reject an originalTransactionId already bound to a different app_user_id (receipt sharing);
//   3. re-fetch authoritative status from the App Store Server API — the SAME source the
//      apple-server-notifications webhook uses;
//   4. reconcile ONE canonical entitlement record (idempotent, out-of-order safe);
//   5. return it in the SDK's EntitlementDto wire shape so the client can unlock immediately.
//
// Request  (POST JSON): { signed_transaction, app_user_id, product_id?, api_key? }
// Response (200 JSON):  { entitlement: EntitlementDto } | (4xx/5xx) { error: string }
//
// Signing credentials for the re-fetch come from apple-jwt.ts env (App Store Connect API key).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { appleToCanonical, reconcileEntitlement } from "../_shared/entitlement-reconcile.ts";
import { assertAppleTransactionNotReused, verifyStoreKit2Jws } from "../_shared/receipt-validate.ts";
import { appStoreServerJwt } from "../_shared/apple-jwt.ts";

/**
 * App Store Server API — "Get All Subscription Statuses". Identical call to the one
 * apple-server-notifications makes, so both paths reconcile from the same authoritative truth.
 */
async function getAllSubscriptionStatuses(
  originalTransactionId: string,
  jwt: string,
  sandbox: boolean,
): Promise<Record<string, any>> {
  const host = sandbox
    ? "https://api.storekit-sandbox.itunes.apple.com"
    : "https://api.storekit.itunes.apple.com";
  const res = await fetch(
    `${host}/inApps/v1/subscriptions/${originalTransactionId}`,
    { headers: { Authorization: `Bearer ${jwt}` } },
  );
  if (!res.ok) {
    throw new Error(`Get All Subscription Statuses failed (${res.status}): ${await res.text()}`);
  }
  return await res.json();
}

/** ISO-8601 string → epoch millis (the EntitlementDto wire format the SDK decodes), or null. */
function isoToMillis(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) ? ms : null;
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return Response.json({ error: "method not allowed" }, { status: 405 });
  }
  try {
    const body = await req.json().catch(() => ({}));
    const signedTransaction: string | undefined = body.signed_transaction;
    const appUserId: string | undefined = body.app_user_id;
    const productIdHint: string | undefined = body.product_id;

    if (!signedTransaction || !appUserId) {
      return Response.json(
        { error: "signed_transaction and app_user_id are required" },
        { status: 400 },
      );
    }

    // 1. Verify the JWS. This is the anti-forgery gate: the x5c chain must terminate at Apple's
    //    pinned root and the ES256 signature must check out against the leaf key.
    const txInfo = await verifyStoreKit2Jws(signedTransaction);
    const originalTxn: string | undefined = txInfo.originalTransactionId;
    if (!originalTxn) {
      return Response.json(
        { error: "signed transaction carries no originalTransactionId" },
        { status: 400 },
      );
    }

    // 2. Replay guard — the same subscription surfacing under a new app user is receipt sharing.
    await assertAppleTransactionNotReused(originalTxn, appUserId);

    // 3. Authoritative re-fetch. The verified JWS proves the transaction is real, but its state can
    //    already be stale (a refund or cancellation issued after purchase), so Apple is asked.
    //    Environment comes from the signed payload, never from the client body.
    const sandbox = txInfo.environment === "Sandbox";
    const truth = await getAllSubscriptionStatuses(originalTxn, await appStoreServerJwt(), sandbox);

    // 4. Reconcile ONE canonical record. appleToCanonical resolves grace/billing-retry/revoked the
    //    same way the ASSN-V2 path does, so a later notification for this same subscription
    //    converges rather than conflicting.
    const canonical = appleToCanonical(truth, originalTxn);
    // Bind the record to THIS app user — the canonical mapper keys on the Apple transaction and has
    // no knowledge of our identity namespace.
    canonical.appUserId = appUserId;
    await reconcileEntitlement(canonical);

    // 5. Return the reconciled entitlement in the SDK EntitlementDto shape (epoch-millis).
    const entitlement = {
      app_user_id: canonical.appUserId,
      provider: canonical.provider, // "app_store"
      product_id: canonical.productId || productIdHint || txInfo.productId || "unknown",
      canonical_state: canonical.canonicalState,
      expires_at: isoToMillis(canonical.expiresAt),
      in_grace_until: isoToMillis(canonical.inGraceUntil),
      will_renew: canonical.willRenew,
      is_sandbox: canonical.isSandbox,
      subscription_id: null,
      latest_event_ts: isoToMillis(canonical.latestEventTs) ?? Date.now(),
    };

    return Response.json({ entitlement }, { status: 200 });
  } catch (err) {
    console.error("register-appstore error:", (err as Error).message);
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
});
