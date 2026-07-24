// supabase/functions/register-play-purchase/index.ts
//
// Client-facing grant endpoint for the Google Play Billing lane (Payments-policy compliance).
//
// After the PayCraft SDK completes an in-app Google Play purchase, it POSTs the purchaseToken here
// so entitlement truth is established SERVER-SIDE (never trusting the client). The engine:
//   1. re-fetches truth from the Play Developer API (purchases.subscriptionsv2.get) — the exact
//      same authoritative source the google-rtdn webhook uses; the request body is never trusted;
//   2. rejects a purchaseToken already bound to a different app_user_id (replay / token theft) via
//      the shared assertPlayTokenNotReused (E2 receipt-validate);
//   3. reconciles ONE canonical entitlement record through the shared reconcileEntitlement (E2);
//   4. returns the reconciled entitlement in the SDK's EntitlementDto wire shape so the client can
//      unlock premium immediately.
//
// Request  (POST JSON): { purchase_token, product_id, app_user_id, package_name, api_key? }
// Response (200 JSON):  { entitlement: EntitlementDto } | (4xx/5xx) { error: string }
//
// Service-account credentials for the Play re-fetch come from GOOGLE_PLAY_SA_JSON (wired in E6).

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { googleToCanonical, reconcileEntitlement } from "../_shared/entitlement-reconcile.ts";
import { assertPlayTokenNotReused } from "../_shared/receipt-validate.ts";
import { playDeveloperJwt } from "../_shared/play-jwt.ts";

// Play Developer API — purchases.subscriptionsv2.get. Re-fetch truth; never trust the client body.
async function subscriptionsv2Get(pkg: string, token: string, jwt: string): Promise<Record<string, any>> {
  const res = await fetch(
    `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${pkg}/purchases/subscriptionsv2/tokens/${token}`,
    { headers: { Authorization: `Bearer ${jwt}` } },
  );
  if (!res.ok) {
    throw new Error(`subscriptionsv2.get failed (${res.status}): ${await res.text()}`);
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
    const purchaseToken: string | undefined = body.purchase_token;
    const productId: string | undefined = body.product_id;
    const appUserId: string | undefined = body.app_user_id;
    const packageName: string | undefined = body.package_name;

    if (!purchaseToken || !appUserId || !packageName) {
      return Response.json(
        { error: "purchase_token, app_user_id and package_name are required" },
        { status: 400 },
      );
    }

    // 1. Authoritative re-fetch from Play (never trust the client's productId/state).
    const jwt = await playDeveloperJwt();
    const truth = await subscriptionsv2Get(packageName, purchaseToken, jwt);

    // 2. Replay guard — a token surfacing under a new user is theft.
    await assertPlayTokenNotReused(purchaseToken, appUserId);

    // 3. Reconcile ONE canonical record (idempotent, out-of-order safe).
    const canonical = googleToCanonical(truth, purchaseToken, appUserId);
    await reconcileEntitlement(canonical);

    // 4. Return the reconciled entitlement in the SDK EntitlementDto shape (epoch-millis timestamps).
    const entitlement = {
      app_user_id: canonical.appUserId,
      provider: canonical.provider, // "google_play"
      product_id: canonical.productId || productId || "unknown",
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
    console.error("register-play-purchase error:", (err as Error).message);
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
});
