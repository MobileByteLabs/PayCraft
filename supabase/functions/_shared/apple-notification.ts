// App Store Server Notifications V2 — the ONE handler, shared by the live webhook
// (apple-server-notifications) and the daily Notification History backfill (store-sync), so a
// notification replayed from history lands exactly like one Apple pushed. The engine NEVER trusts the
// notification body: it (1) JWS-verifies the signed envelope, (2) re-fetches truth from the App Store
// Server API "Get All Subscription Statuses", and (3) reconciles ONE canonical record.
//
// Attempts (migration 210): appAccountToken is already the app USER, so Apple carries no field for the
// SDK's attempt id. register-appstore maps the purchase's original_transaction_id → attempt_id; this handler
// reads it back. An entitled status moves the attempt to `provider_result` and the reconcile closes it as
// granted; a failure while processing closes it failed at stage `webhook`. Best-effort throughout.

import { verifyStoreKit2Jws } from "./receipt-validate.ts";
import { handleConsumablePurchase } from "./consumable-handler.ts";
import { resolveInboundTenant } from "./inbound-tenant.ts";
import { appleToCanonical, isEntitledState, reconcileEntitlement } from "./entitlement-reconcile.ts";
import {
  attemptBestEffort,
  closeAsFailed,
  closeAsGranted,
  resolveAttemptIdForAppStoreTxn,
  transitionAttempt,
} from "./payment-attempts.ts";
import { supabaseAdmin } from "./supabase-admin.ts";
import { tenantAppStoreServerJwt } from "./apple-jwt.ts";
import { answerConsumptionRequest } from "./appstore-consumption.ts";

// App Store Server API — "Get All Subscription Statuses". NEVER trust the ASSN-V2 payload state;
// re-fetch the authoritative status for the originalTransactionId.
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

/** Decode the JWS transaction payload (middle segment, base64url). Null when absent/unparseable. */
export function decodeSignedTransaction(signed: string | undefined): Record<string, any> | null {
  const seg = (signed ?? "").split(".")[1];
  if (!seg) return null;
  try {
    return JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(seg.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
      ),
    );
  } catch {
    return null;
  }
}

/** Verify one ASSN-V2 `signedPayload` and apply it. Throws on anything the caller must not ack. */
export async function processAppleNotification(signedPayload: string): Promise<void> {
  const notif = await verifyStoreKit2Jws(signedPayload);
  const data = notif.data ?? {};
  const originalTxn: string | undefined = data.originalTransactionId ??
    // Fall back to the signed transaction info payload if the envelope omits it. Shares the
    // decoder with the ONE_TIME_CHARGE path below rather than inlining a second copy — the
    // original inline version also threw on a malformed segment, where the helper returns null.
    decodeSignedTransaction(data.signedTransactionInfo)?.originalTransactionId;
  if (!originalTxn) throw new Error("missing originalTransactionId");

  // ── Refund request (migration 207) ────────────────────────────────────────────────────────
  // A customer asked Apple for a refund. Nothing about the entitlement changes yet (a granted refund arrives later
  // as REFUND), so this only answers Apple with consumption information, within its 12-hour window.
  if (notif.notificationType === "CONSUMPTION_REQUEST") {
    const tx = decodeSignedTransaction(data.signedTransactionInfo) ?? {};
    const { tenantId } = await resolveInboundTenant({
      appIdentifier: data.bundleId ?? tx.bundleId ?? null,
      provider: "app_store",
    });
    const outcome = await answerConsumptionRequest({
      tenantId,
      tx,
      sandbox: (data.environment ?? notif.environment) === "Sandbox",
      jwt: () => tenantAppStoreServerJwt(tenantId),
    });
    console.log(`[apple-server-notifications] CONSUMPTION_REQUEST ${tx.transactionId ?? "?"}: ${outcome}`);
    return;
  }

  // ── One-time charge (consumable pack) ─────────────────────────────────────────────────────
  // ASSN-V2 fires ONE_TIME_CHARGE for a consumable / non-consumable purchase. It has no
  // subscription to reconcile, so it previously flowed into getAllSubscriptionStatuses below and
  // produced nothing useful — the customer was charged and the balance never moved.
  //
  // Like Play, this endpoint is per-DEPLOYMENT with no tenant, so the grant derives it from the
  // catalogue row owning this productId as its app_store_product_id.
  if (notif.notificationType === "ONE_TIME_CHARGE") {
    const tx = decodeSignedTransaction(data.signedTransactionInfo);
    const productId: string | undefined = tx?.productId;
    // appAccountToken is the app's own user id, set by the SDK at purchase. Apple exposes no
    // email, and originalTransactionId identifies the PURCHASE rather than the buyer — using it
    // as identity would mint a fresh subject per purchase and scatter one player's balance.
    const appUserId: string | undefined = tx?.appAccountToken;
    if (!productId || !appUserId) {
      console.error(
        `[apple-server-notifications] ONE_TIME_CHARGE missing ${!productId ? "productId" : "appAccountToken"} — cannot attribute the grant`,
      );
      return;
    }
    const grant = await handleConsumablePurchase({
      tenantId: null,
      // bundleId identifies the APP; tenants.app_identifier holds the same string for both
      // stores (migration 111). Falls back to the signed transaction's copy when the envelope
      // omits it, the same way originalTransactionId is recovered above.
      appIdentifier: data.bundleId ?? tx?.bundleId ?? null,
      storeProductId: productId,
      identity: { kind: "auth_user", value: appUserId },
      // transactionId is unique per purchase; originalTransactionId is shared across a renewal
      // family, so keying on it would make a second pack look like a redelivery of the first.
      stableTxnId: tx?.transactionId ?? originalTxn,
      provider: "app_store",
      eventType: notif.notificationType,
    });
    if (!grant.granted) {
      console.error(`[apple-server-notifications] consumable grant refused for ${productId}: ${grant.reason}`);
      return;
    }
    // A pack credits a balance, not an entitlement record — the credit IS the grant.
    const packAttempt = await attemptBestEffort(`apple map ${originalTxn}`, () =>
      resolveAttemptIdForAppStoreTxn(supabaseAdmin, originalTxn));
    if (packAttempt) {
      await attemptBestEffort(`apple consumable grant ${packAttempt}`, async () => {
        await transitionAttempt(supabaseAdmin, packAttempt, "provider_result", {
          paid_at: purchaseIso(tx?.purchaseDate),
          provider_subscription_id: originalTxn,
        });
        return closeAsGranted(supabaseAdmin, packAttempt);
      });
    }
    return;
  }

  const sandbox = (notif.data?.environment ?? notif.environment) === "Sandbox";
  // Attribute to the APP — see the Play handler: a NULL-tenant entitlement row silently reads as
  // not-premium on a multi-tenant deployment. bundleId is the same string Play calls packageName.
  // Resolved BEFORE the re-fetch: the app also decides which App Store key may ask Apple.
  const { tenantId: subTenantId } = await resolveInboundTenant({
    appIdentifier: data.bundleId ?? decodeSignedTransaction(data.signedTransactionInfo)?.bundleId ?? null,
    provider: "app_store",
  });
  // The attempt register-appstore mapped this purchase to — resolved before the re-fetch so a failed
  // re-fetch still lands on it.
  const attemptId = await attemptBestEffort(`apple map ${originalTxn}`, () =>
    resolveAttemptIdForAppStoreTxn(supabaseAdmin, originalTxn));
  try {
    const truth = await getAllSubscriptionStatuses(originalTxn, await tenantAppStoreServerJwt(subTenantId), sandbox);
    const canonical = { ...appleToCanonical(truth, originalTxn), tenantId: subTenantId };
    // Apple says the subscription is live (paid or in trial): that is the provider's answer to the attempt.
    if (attemptId && isEntitledState(canonical.canonicalState)) {
      await attemptBestEffort(`apple provider_result ${attemptId}`, () =>
        transitionAttempt(supabaseAdmin, attemptId, "provider_result", {
          paid_at: purchaseIso(decodeSignedTransaction(data.signedTransactionInfo)?.purchaseDate),
          provider_subscription_id: originalTxn,
        }));
    }
    // preserveOwner: appleToCanonical keys on the appAccountToken UUID, never the SDK's
    // app-user-id — writing it would re-key the row away from get_entitlements on every renewal.
    await reconcileEntitlement(canonical, { preserveOwner: true, attemptId });
  } catch (err) {
    if (attemptId) {
      await attemptBestEffort(`apple notification failure ${attemptId}`, () =>
        closeAsFailed(supabaseAdmin, attemptId, {
          stage: "webhook",
          error_class: "app_store_notification",
          error_code: "processing_error",
          error_message: (err as Error).message,
        }));
    }
    throw err;
  }
}

/** Apple's purchaseDate (epoch ms) as ISO, or now when absent. */
function purchaseIso(ms: unknown): string {
  const n = typeof ms === "string" ? Number(ms) : ms;
  return typeof n === "number" && Number.isFinite(n) ? new Date(n).toISOString() : new Date().toISOString();
}
