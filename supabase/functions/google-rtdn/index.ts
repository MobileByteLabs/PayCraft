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

    const sub = rtdn.subscriptionNotification;
    if (!sub?.purchaseToken) {
      // Not a subscription notification (test publish / voidedPurchase / oneTimeProduct) — ack.
      return new Response("ok", { status: 200 });
    }

    const jwt = await playDeveloperJwt();
    const truth = await subscriptionsv2Get(rtdn.packageName, sub.purchaseToken, jwt);
    // Prefer the developer-supplied obfuscated account id for stable identity linking.
    const appUserId: string = truth.externalAccountIdentifiers?.obfuscatedExternalAccountId ??
      truth.externalAccountIdentifiers?.externalAccountId ??
      sub.purchaseToken;

    await assertPlayTokenNotReused(sub.purchaseToken, appUserId);
    await reconcileEntitlement(googleToCanonical(truth, sub.purchaseToken, appUserId));
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("google-rtdn error:", (err as Error).message);
    // 500 so Pub/Sub retries transient failures; a poison message eventually dead-letters.
    return new Response((err as Error).message, { status: 500 });
  }
});
