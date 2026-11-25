// supabase/functions/register-play-purchase/index.ts
//
// Client-facing grant endpoint for the Google Play Billing lane (Payments-policy compliance).
//
// After the PayCraft SDK completes an in-app Google Play purchase, it POSTs the purchaseToken here
// so entitlement truth is established SERVER-SIDE (never trusting the client). The engine:
//   1. re-fetches truth from the Play Developer API (purchases.subscriptionsv2.get) — the exact
//      same authoritative source the google-rtdn webhook uses; the request body is never trusted;
//   2. binds the token to app_user_id via the shared claimStoreTransaction: a token held by an
//      ANONYMOUS device id transfers (reinstall / new phone / sign-in linking), one held by a
//      signed-in identity is refused with 409 { code: "sign_in_required" };
//   3. reconciles ONE canonical entitlement record through the shared reconcileEntitlement (E2);
//   4. returns the reconciled entitlement in the SDK's EntitlementDto wire shape so the client can
//      unlock premium immediately.
//
// Request  (POST JSON): { purchase_token, product_id, app_user_id, package_name, api_key?, attempt_id? }
// Response (200 JSON):  { entitlement: EntitlementDto } | (409) { error, code: "sign_in_required" }
//                       | (4xx/5xx) { error: string }
//
// Service-account credentials for the Play re-fetch come from GOOGLE_PLAY_SA_JSON (wired in E6).
//
// Attempts (migration 210): `attempt_id` (optional — older SDKs send none) names the SDK's purchase
// attempt. Once Play's truth is read the attempt is opened (store lane: no server-side checkout page), the
// purchase token is mapped to it for later RTDNs, an entitled purchase moves it to `provider_result`, and
// the reconcile closes it as granted. A failure is recorded on it at stage `server` and the HTTP answer is
// unchanged. Best-effort: attempt bookkeeping never costs the buyer their entitlement.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { googleToCanonical, reconcileEntitlement } from "../_shared/entitlement-reconcile.ts";
import { claimStoreTransaction, StoreTransactionOwnedError } from "../_shared/receipt-validate.ts";
import { resolveInboundTenant } from "../_shared/inbound-tenant.ts";
import { tenantPlayDeveloperJwt } from "../_shared/play-jwt.ts";
import { isEntitledState } from "../_shared/entitlement-reconcile.ts";
import {
  attemptBestEffort,
  mapPlayTokenToAttempt,
  normaliseAttemptId,
  openAttempt,
  recordAttemptFailure,
  transitionAttempt,
} from "../_shared/payment-attempts.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";

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
  // Known once the request is read and the app resolved — the failure path records against them.
  let attemptId: string | null = null;
  let attemptTenant: string | null = null;
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
    attemptId = normaliseAttemptId(body.attempt_id);
    if (body.attempt_id != null && !attemptId) {
      return Response.json({ error: "attempt_id must be 1–100 characters of A–Z a–z 0–9 _ . : -" }, { status: 400 });
    }

    // 0. The APP the purchase belongs to — it decides both the record's tenant and WHICH Play
    //    service account may ask Google about it (each app connects its own).
    const { tenantId } = await resolveInboundTenant({ appIdentifier: packageName, provider: "google_play" });
    attemptTenant = tenantId;

    // 1. Authoritative re-fetch from Play (never trust the client's productId/state).
    const jwt = await tenantPlayDeveloperJwt(tenantId);
    const truth = await subscriptionsv2Get(packageName, purchaseToken, jwt);

    // 2. Ownership — Play just proved the token is real, so this only decides WHO holds it.
    await claimStoreTransaction("google_play", purchaseToken, appUserId);

    // 3. Reconcile ONE canonical record (idempotent, out-of-order safe), attributed to the APP — a
    //    NULL tenant never matches get_entitlements' tenant filter, so the purchase would vanish on
    //    the next read (restore included).
    const canonical = { ...googleToCanonical(truth, purchaseToken, appUserId), tenantId };
    const attempt = attemptId;
    if (attempt && tenantId) {
      await attemptBestEffort(`register-play attempt ${attempt}`, async () => {
        await openAttempt(supabaseAdmin, {
          attempt_id: attempt,
          tenant_id: tenantId,
          provider: "google_play",
          mode: canonical.isSandbox ? "test" : "live",
          app_user_id: appUserId,
          plan: canonical.productId !== "unknown" ? canonical.productId : productId ?? null,
        });
        // An RTDN for this token from an SDK that could not set obfuscatedProfileId still finds the attempt.
        await mapPlayTokenToAttempt(supabaseAdmin, tenantId, purchaseToken, attempt);
        if (isEntitledState(canonical.canonicalState)) {
          await transitionAttempt(supabaseAdmin, attempt, "provider_result", {
            paid_at: typeof truth.startTime === "string" ? new Date(truth.startTime).toISOString() : new Date().toISOString(),
            provider_subscription_id: purchaseToken,
          });
        }
      });
    }
    await reconcileEntitlement(canonical, { attemptId: attempt && tenantId ? attempt : null });

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
    const failed = attemptId;
    if (failed) {
      await attemptBestEffort(`register-play failure ${failed}`, () =>
        recordAttemptFailure(supabaseAdmin, failed, attemptTenant, {
          stage: "server",
          error_class: "register_play",
          error_code: err instanceof StoreTransactionOwnedError ? err.code : "processing_error",
          error_message: (err as Error).message,
        }));
    }
    if (err instanceof StoreTransactionOwnedError) {
      return Response.json({ error: err.message, code: err.code }, { status: 409 });
    }
    console.error("register-play-purchase error:", (err as Error).message);
    return Response.json({ error: (err as Error).message }, { status: 500 });
  }
});
