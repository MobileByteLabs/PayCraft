// App Store Server Notifications V2 — the ONE handler, shared by the live webhook
// (apple-server-notifications) and the daily Notification History backfill (store-sync), so a
// notification replayed from history lands exactly like one Apple pushed. The engine NEVER trusts the
// notification body: it (1) JWS-verifies the signed envelope, (2) re-fetches truth from the App Store
// Server API "Get All Subscription Statuses", and (3) reconciles ONE canonical record.

import { verifyStoreKit2Jws } from "./receipt-validate.ts";
import { handleConsumablePurchase } from "./consumable-handler.ts";
import { resolveInboundTenant } from "./inbound-tenant.ts";
import { appleToCanonical, reconcileEntitlement } from "./entitlement-reconcile.ts";
import { tenantAppStoreServerJwt } from "./apple-jwt.ts";

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
  const truth = await getAllSubscriptionStatuses(originalTxn, await tenantAppStoreServerJwt(subTenantId), sandbox);
  // preserveOwner: appleToCanonical keys on the appAccountToken UUID, never the SDK's
  // app-user-id — writing it would re-key the row away from get_entitlements on every renewal.
  await reconcileEntitlement({
    ...appleToCanonical(truth, originalTxn),
    tenantId: subTenantId,
  }, { preserveOwner: true });
}
