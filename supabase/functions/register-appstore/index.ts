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
//   2. bind the originalTransactionId to app_user_id via claimStoreTransaction — an ANONYMOUS
//      holder transfers (reinstall / new phone / sign-in), a signed-in holder is refused with 409
//      { code: "sign_in_required" };
//   3. re-fetch authoritative status from the App Store Server API — the SAME source the
//      apple-server-notifications webhook uses;
//   4. reconcile ONE canonical entitlement record (idempotent, out-of-order safe);
//   5. return it in the SDK's EntitlementDto wire shape so the client can unlock immediately.
//
// Request  (POST JSON): { signed_transaction, app_user_id, product_id?, api_key?, attempt_id? }
// Response (200 JSON):  { entitlement: EntitlementDto } | (4xx/5xx) { error: string }
//
// Signing credentials for the re-fetch come from apple-jwt.ts env (App Store Connect API key).
//
// Attempts (migration 210): `attempt_id` (optional — older SDKs send none) names the SDK's purchase
// attempt. appAccountToken is already the app USER, so the attempt rides an original_transaction_id →
// attempt_id map written here, which apple-server-notifications reads back. Once the JWS is verified the
// attempt is opened (store lane) and mapped; an entitled status moves it to `provider_result`; the reconcile
// closes it as granted. A failure is recorded on it at stage `server` and the HTTP answer is unchanged.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { appleToCanonical, reconcileEntitlement } from "../_shared/entitlement-reconcile.ts";
import {
  claimStoreTransaction,
  StoreTransactionOwnedError,
  verifyStoreKit2Jws,
} from "../_shared/receipt-validate.ts";
import { resolveInboundTenant } from "../_shared/inbound-tenant.ts";
import { tenantAppStoreServerJwt } from "../_shared/apple-jwt.ts";
import { isEntitledState } from "../_shared/entitlement-reconcile.ts";
import {
  attemptBestEffort,
  mapAppStoreTxnToAttempt,
  normaliseAttemptId,
  openAttempt,
  recordAttemptFailure,
  transitionAttempt,
} from "../_shared/payment-attempts.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";

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
  // Known once the request is read and the app resolved — the failure path records against them.
  let attemptId: string | null = null;
  let attemptTenant: string | null = null;
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
    attemptId = normaliseAttemptId(body.attempt_id);
    if (body.attempt_id != null && !attemptId) {
      return Response.json({ error: "attempt_id must be 1–100 characters of A–Z a–z 0–9 _ . : -" }, { status: 400 });
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

    // 1b. The attempt — the JWS is verified, so the app (signed bundleId) and the environment are known.
    const { tenantId } = await resolveInboundTenant({ appIdentifier: txInfo.bundleId ?? null, provider: "app_store" });
    attemptTenant = tenantId;
    const attempt = attemptId && tenantId ? attemptId : null;
    if (attempt && tenantId) {
      await attemptBestEffort(`register-appstore attempt ${attempt}`, async () => {
        await openAttempt(supabaseAdmin, {
          attempt_id: attempt,
          tenant_id: tenantId,
          provider: "app_store",
          mode: txInfo.environment === "Sandbox" ? "test" : "live",
          app_user_id: appUserId,
          plan: txInfo.productId ?? productIdHint ?? null,
        });
        await mapAppStoreTxnToAttempt(supabaseAdmin, tenantId, originalTxn, attempt);
      });
    }

    // 2. Ownership — the JWS is verified, so this only decides WHO holds the subscription.
    await claimStoreTransaction("app_store", originalTxn, appUserId);

    // 3. Authoritative re-fetch. The verified JWS proves the transaction is real, but its state can
    //    already be stale (a refund or cancellation issued after purchase), so Apple is asked.
    //    Environment comes from the signed payload, never from the client body.
    //    The APP (resolved in 1b from the SIGNED bundleId) decides both the record's tenant and which
    //    App Store key may ask Apple (each app connects its own).
    const sandbox = txInfo.environment === "Sandbox";
    const truth = await getAllSubscriptionStatuses(originalTxn, await tenantAppStoreServerJwt(tenantId), sandbox);

    // 4. Reconcile ONE canonical record. appleToCanonical resolves grace/billing-retry/revoked the
    //    same way the ASSN-V2 path does, so a later notification for this same subscription
    //    converges rather than conflicting.
    const canonical = appleToCanonical(truth, originalTxn);
    // Bind the record to THIS app user — the canonical mapper keys on the Apple transaction and has
    // no knowledge of our identity namespace.
    canonical.appUserId = appUserId;
    // Attributed to the APP — a NULL tenant never matches get_entitlements' tenant filter, so the
    // purchase would vanish on read.
    canonical.tenantId = tenantId;
    if (attempt && isEntitledState(canonical.canonicalState)) {
      const purchaseMs = Number(txInfo.purchaseDate);
      await attemptBestEffort(`register-appstore provider_result ${attempt}`, () =>
        transitionAttempt(supabaseAdmin, attempt, "provider_result", {
          paid_at: Number.isFinite(purchaseMs) ? new Date(purchaseMs).toISOString() : new Date().toISOString(),
          provider_subscription_id: originalTxn,
        }));
    }
    await reconcileEntitlement(canonical, { attemptId: attempt });

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
    const failed = attemptId;
    if (failed) {
      await attemptBestEffort(`register-appstore failure ${failed}`, () =>
        recordAttemptFailure(supabaseAdmin, failed, attemptTenant, {
          stage: "server",
          error_class: "register_appstore",
          error_code: err instanceof StoreTransactionOwnedError ? err.code : "processing_error",
          error_message: (err as Error).message,
        }));
    }
    if (err instanceof StoreTransactionOwnedError) {
      return Response.json({ error: err.message, code: err.code }, { status: 409 });
    }
    console.error("register-appstore error:", (err as Error).message);
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
});
