// supabase/functions/google-rtdn/index.ts
//
// Ingest Google Play Real-time Developer Notifications (RTDN) delivered via a Pub/Sub push
// subscription. The engine NEVER trusts the notification body: it (1) decodes the Pub/Sub
// envelope, (2) re-fetches truth from the Play Developer API purchases.subscriptionsv2.get,
// (3) rejects a purchaseToken reused by a different user, and (4) reconciles ONE canonical record.
//
// Endpoint (E6 wiring): register this URL as the Pub/Sub push endpoint for the RTDN topic
// configured in the Play Console. Service-account credentials for the re-fetch come from play-jwt.ts.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handleConsumablePurchase } from "../_shared/consumable-handler.ts";
import { resolveInboundTenant } from "../_shared/inbound-tenant.ts";
import { reconcileEntitlement, googleToCanonical } from "../_shared/entitlement-reconcile.ts";
import { assertPlayTokenNotReused } from "../_shared/receipt-validate.ts";
import { playDeveloperJwt } from "../_shared/play-jwt.ts";

// Play Developer API — purchases.subscriptionsv2.get. Re-fetch truth; never trust the RTDN body.
async function subscriptionsv2Get(
  pkg: string,
  token: string,
  jwt: string,
): Promise<Record<string, any>> {
  const res = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}/purchases/subscriptionsv2/tokens/${token}`,
    { headers: { Authorization: `Bearer ${jwt}` } },
  );
  if (!res.ok) {
    throw new Error(`subscriptionsv2.get failed (${res.status}): ${await res.text()}`);
  }
  return await res.json();
}

/**
 * Resolve the app-supplied account id for a one-time purchase via `purchases.products.get`.
 *
 * Separate from the subscription path's `subscriptionsv2Get`: managed products are a different
 * Play resource and carry the identifier under `obfuscatedExternalAccountId` on the product
 * purchase itself. Returns null when the app did not set one, which is a REFUSAL rather than a
 * fallback to the purchase token: attributing a paid grant to a token would mint a throwaway
 * subject the buyer can never sign back into.
 */
async function oneTimeProductAppUserId(
  packageName: string,
  sku: string,
  token: string,
  jwt: string,
): Promise<string | null> {
  const res = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${packageName}/purchases/products/${encodeURIComponent(sku)}/tokens/${encodeURIComponent(token)}`,
    { headers: { Authorization: `Bearer ${jwt}` } },
  );
  if (!res.ok) {
    console.error(`[google-rtdn] purchases.products.get failed (${res.status})`);
    return null;
  }
  const purchase = await res.json();
  return purchase?.obfuscatedExternalAccountId ?? null;
}

serve(async (req: Request) => {
  try {
    const envelope = await req.json(); // Pub/Sub push: { message: { data: <base64 DeveloperNotification> } }
    const message = envelope.message;
    if (!message?.data) {
      // Pub/Sub subscription-verification pings arrive with no data — ack them.
      return new Response("ok", { status: 200 });
    }
    const rtdn = JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(message.data), (c) => c.charCodeAt(0)),
      ),
    ); // DeveloperNotification

    // ── One-time product (consumable pack) ────────────────────────────────────────────────────
    // notificationType 1 = ONE_TIME_PRODUCT_PURCHASED, 2 = ONE_TIME_PRODUCT_CANCELED. Until now
    // this notification fell into the ack-and-drop below, so a pack bought on Play charged the
    // customer and credited nothing.
    //
    // There is no tenant on this endpoint — the Pub/Sub topic is per-DEPLOYMENT — so the grant
    // resolves it from the catalogue row that owns this `sku` as its play_product_id, which the
    // product sync wrote back when it created the product.
    const oneTime = rtdn.oneTimeProductNotification;
    if (oneTime?.purchaseToken && oneTime?.sku) {
      if (oneTime.notificationType !== 1) {
        // Only a PURCHASE grants. A cancellation/refund is a negative ledger row, which belongs
        // with the refund path rather than being inferred here — granting on it would be wrong and
        // silently reversing a spend the player has already made would be worse.
        return new Response("ok", { status: 200 });
      }
      const jwt = await playDeveloperJwt();
      // The obfuscated account id is the app's OWN user id, threaded through the purchase by the
      // SDK. It is the only buyer identity Play exposes — there is no email on a store purchase.
      const appUserId = await oneTimeProductAppUserId(rtdn.packageName, oneTime.sku, oneTime.purchaseToken, jwt);
      if (!appUserId) {
        console.error(`[google-rtdn] one-time purchase ${oneTime.sku} has no account id — cannot attribute the grant`);
        return new Response("ok", { status: 200 });
      }
      const grant = await handleConsumablePurchase({
        tenantId: null,
        // The APP the purchase happened in — this is what attributes it to a tenant
        // (tenants.app_identifier), exactly as a per-tenant-app scoping requires. Resolving on the
        // sku alone would mis-attribute when two tenants ship the same product id.
        appIdentifier: rtdn.packageName,
        storeProductId: oneTime.sku,
        identity: { kind: "auth_user", value: appUserId },
        // The purchase token is unique per purchase and is what Play redelivers on, so it is the
        // correct idempotency anchor.
        stableTxnId: oneTime.purchaseToken,
        provider: "google_play",
        eventType: `oneTimeProduct.${oneTime.notificationType}`,
      });
      if (!grant.granted) {
        console.error(`[google-rtdn] consumable grant refused for ${oneTime.sku}: ${grant.reason}`);
      }
      return new Response("ok", { status: 200 });
    }

    const sub = rtdn.subscriptionNotification;
    if (!sub?.purchaseToken) {
      // Not a subscription notification (test publish / voidedPurchase) — ack.
      return new Response("ok", { status: 200 });
    }

    const jwt = await playDeveloperJwt();
    const truth = await subscriptionsv2Get(rtdn.packageName, sub.purchaseToken, jwt);
    // Attribute to the APP. Until now every Play subscription was reconciled with tenant_id NULL,
    // and a NULL-tenant row never matches check_premium_with_device()'s
    // `tenant_id IS NOT DISTINCT FROM` filter — so is_premium read false for a paying customer on
    // any multi-tenant deployment. Same resolver the consumable path and the web PSPs use.
    const { tenantId: subTenantId } = await resolveInboundTenant({
      appIdentifier: rtdn.packageName,
      provider: "google_play",
    });
    // Prefer the developer-supplied obfuscated account id for stable identity linking.
    const appUserId: string = truth.externalAccountIdentifiers?.obfuscatedExternalAccountId ??
      truth.externalAccountIdentifiers?.externalAccountId ??
      sub.purchaseToken;

    await assertPlayTokenNotReused(sub.purchaseToken, appUserId);
    await reconcileEntitlement({
      ...googleToCanonical(truth, sub.purchaseToken, appUserId),
      tenantId: subTenantId,
    });
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("google-rtdn error:", (err as Error).message);
    // 500 so Pub/Sub retries transient failures; a poison message eventually dead-letters.
    return new Response((err as Error).message, { status: 500 });
  }
});
