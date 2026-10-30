// supabase/functions/apple-server-notifications/index.ts
//
// Ingest Apple App Store Server Notifications V2 (ASSN-V2). The engine NEVER trusts the
// notification body: it (1) JWS-verifies the signed envelope, (2) re-fetches truth from the
// App Store Server API "Get All Subscription Statuses", and (3) reconciles ONE canonical record.
//
// Endpoint (E6 wiring): set this URL as the App Store Server Notifications V2 URL in App Store
// Connect. Live signing credentials for the re-fetch are provided via apple-jwt.ts env in E6.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { verifyStoreKit2Jws } from "../_shared/receipt-validate.ts";
import { handleConsumablePurchase } from "../_shared/consumable-handler.ts";
import { resolveInboundTenant } from "../_shared/inbound-tenant.ts";
import { reconcileEntitlement, appleToCanonical } from "../_shared/entitlement-reconcile.ts";
import { appStoreServerJwt } from "../_shared/apple-jwt.ts";

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
function decodeSignedTransaction(signed: string | undefined): Record<string, any> | null {
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

serve(async (req: Request) => {
  try {
    const body = await req.json();
    // ASSN-V2 delivers { signedPayload } — a JWS whose payload holds notificationType + data.
    const notif = await verifyStoreKit2Jws(body.signedPayload);
    const data = notif.data ?? {};
    const originalTxn: string | undefined = data.originalTransactionId ??
      // Fall back to the signed transaction info payload if the envelope omits it. Shares the
      // decoder with the ONE_TIME_CHARGE path below rather than inlining a second copy — the
      // original inline version also threw on a malformed segment, where the helper returns null.
      decodeSignedTransaction(data.signedTransactionInfo)?.originalTransactionId;
    if (!originalTxn) {
      return new Response("missing originalTransactionId", { status: 400 });
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
        return new Response("ok", { status: 200 });
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
      return new Response("ok", { status: 200 });
    }

    const sandbox = (notif.data?.environment ?? notif.environment) === "Sandbox";
    const truth = await getAllSubscriptionStatuses(originalTxn, await appStoreServerJwt(), sandbox);
    // Attribute to the APP — see the Play handler: a NULL-tenant entitlement row silently reads as
    // not-premium on a multi-tenant deployment. bundleId is the same string Play calls packageName.
    const { tenantId: subTenantId } = await resolveInboundTenant({
      appIdentifier: data.bundleId ?? decodeSignedTransaction(data.signedTransactionInfo)?.bundleId ?? null,
      provider: "app_store",
    });
    // preserveOwner: appleToCanonical keys on the appAccountToken UUID, never the SDK's
    // app-user-id — writing it would re-key the row away from get_entitlements on every renewal.
    await reconcileEntitlement({
      ...appleToCanonical(truth, originalTxn),
      tenantId: subTenantId,
    }, { preserveOwner: true });
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("apple-server-notifications error:", (err as Error).message);
    // 4xx so Apple retries transient failures without wedging on a permanent bad payload.
    return new Response((err as Error).message, { status: 400 });
  }
});
