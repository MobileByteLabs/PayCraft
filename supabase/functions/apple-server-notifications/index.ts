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

serve(async (req: Request) => {
  try {
    const body = await req.json();
    // ASSN-V2 delivers { signedPayload } — a JWS whose payload holds notificationType + data.
    const notif = await verifyStoreKit2Jws(body.signedPayload);
    const data = notif.data ?? {};
    const originalTxn: string | undefined = data.originalTransactionId ??
      // Fall back to the signed transaction info payload if the envelope omits it.
      (() => {
        const seg = (data.signedTransactionInfo ?? "").split(".")[1];
        if (!seg) return undefined;
        const tx = JSON.parse(
          new TextDecoder().decode(
            Uint8Array.from(atob(seg.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
          ),
        );
        return tx.originalTransactionId;
      })();
    if (!originalTxn) {
      return new Response("missing originalTransactionId", { status: 400 });
    }

    const sandbox = (notif.data?.environment ?? notif.environment) === "Sandbox";
    const truth = await getAllSubscriptionStatuses(originalTxn, await appStoreServerJwt(), sandbox);
    await reconcileEntitlement(appleToCanonical(truth, originalTxn));
    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("apple-server-notifications error:", (err as Error).message);
    // 4xx so Apple retries transient failures without wedging on a permanent bad payload.
    return new Response((err as Error).message, { status: 400 });
  }
});
