// supabase/functions/_shared/entitlement-reconcile.ts
//
// E2 reconciliation core (GOAL D5/D6). Every ingest surface — Apple ASSN-V2, Google RTDN,
// and the 11 web PSP webhooks — normalizes its provider event into a CanonicalEvent and calls
// reconcileEntitlement(). The engine is:
//   • idempotent      — keyed UPSERT on (provider, stable_txn_id); replays collapse to one row.
//   • out-of-order safe — a monotonic latest_event_ts guard drops any event not strictly newer
//                         than what is already stored, so late/duplicate delivery cannot regress state.
//   • store-authoritative — callers pass state derived from a store-server-API RE-FETCH, never the
//                         raw notification body (see apple-server-notifications / google-rtdn).
//
// canonical_state is the exact snake_case vocabulary of the Phase-1 sealed SubscriptionState
// (cmp-paycraft SubscriptionState.kt): grace = active, billing-retry/on-hold = inactive.

import { supabaseAdmin } from "./supabase-admin.ts";

/** The 10 canonical states — 1:1 with cmp-paycraft SubscriptionState (Phase 1). */
export type CanonicalState =
  | "trial"
  | "active"
  | "active_non_renewing"
  | "in_grace_period"
  | "on_billing_retry"
  | "paused"
  | "expired"
  | "cancelled"
  | "refunded"
  | "pending";

/** The single contract every provider adapter emits into the reconciliation engine. */
export interface CanonicalEvent {
  appUserId: string;
  tenantId: string | null;
  provider: string;
  productId: string;
  stableTxnId: string;
  canonicalState: CanonicalState;
  expiresAt: string | null;
  willRenew: boolean;
  inGraceUntil: string | null;
  isSandbox: boolean;
  latestEventTs: string;
  /** Optional raw store-API snapshot persisted for audit/debug (never trusted for gating). */
  rawStoreState?: Record<string, unknown> | null;
}

/**
 * Idempotent, out-of-order-safe UPSERT of one normalized entitlement record.
 *
 * Idempotency: the (provider, stable_txn_id) unique key means a replay of the same event
 * targets the same row. Out-of-order guard: we only overwrite when the incoming event is
 * STRICTLY newer than the stored latest_event_ts — a stale or duplicate delivery returns early.
 */
export async function reconcileEntitlement(ev: CanonicalEvent): Promise<void> {
  const { data: existing, error: selErr } = await supabaseAdmin
    .from("entitlement_records")
    .select("latest_event_ts")
    .eq("provider", ev.provider)
    .eq("stable_txn_id", ev.stableTxnId)
    .maybeSingle();
  if (selErr) throw new Error(`reconcile select failed: ${selErr.message}`);

  // Monotonic guard: drop events that are not strictly newer than the stored truth.
  if (existing && new Date(existing.latest_event_ts) >= new Date(ev.latestEventTs)) return;

  const { error } = await supabaseAdmin.from("entitlement_records").upsert(
    {
      app_user_id: ev.appUserId,
      tenant_id: ev.tenantId,
      provider: ev.provider,
      product_id: ev.productId,
      stable_txn_id: ev.stableTxnId,
      canonical_state: ev.canonicalState,
      expires_at: ev.expiresAt,
      will_renew: ev.willRenew,
      in_grace_until: ev.inGraceUntil,
      is_sandbox: ev.isSandbox,
      latest_event_ts: ev.latestEventTs,
      raw_store_state: ev.rawStoreState ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "provider,stable_txn_id" },
  );
  if (error) throw new Error(`reconcile upsert failed: ${error.message}`);
}

// ---------------------------------------------------------------------------
// Provider → canonical mappers. These translate a STORE-SERVER-API re-fetch (not the
// notification body) into a CanonicalEvent. The nested Apple JWS payloads reach these
// mappers already decoded (they arrive over Apple's authenticated TLS API); full nested-JWS
// re-verification is E6 device-truth scope (see plan Out of scope).
// ---------------------------------------------------------------------------

/** Decode the middle segment of a compact JWS as JSON WITHOUT verifying — the payload came
 *  from an authenticated store-server-API response, not an untrusted webhook body. */
function decodeJwsPayload(jws: string | undefined | null): Record<string, any> {
  if (!jws) return {};
  const seg = jws.split(".")[1];
  if (!seg) return {};
  const json = new TextDecoder().decode(
    Uint8Array.from(atob(seg.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)),
  );
  return JSON.parse(json);
}

function isoOrNull(ms: number | string | undefined | null): string | null {
  if (ms === undefined || ms === null || ms === "") return null;
  const n = typeof ms === "string" ? Number(ms) : ms;
  if (!Number.isFinite(n)) return null;
  return new Date(n).toISOString();
}

/**
 * Apple App Store Server API — "Get All Subscription Statuses" response → CanonicalEvent.
 *
 * Apple `status` codes (per lastTransaction): 1=Active, 2=Expired, 3=In billing retry,
 * 4=In billing grace period, 5=Revoked. We refine 1 with the renewal info's autoRenewStatus
 * (0 ⇒ active_non_renewing) and offerType (trial). This maps onto the Phase-1 machine where
 * grace = in_grace_period (active) and billing-retry = on_billing_retry (inactive).
 */
export function appleToCanonical(
  statuses: Record<string, any>,
  originalTransactionId: string,
  eventTsOverride?: string,
): CanonicalEvent {
  // Locate the lastTransaction for this originalTransactionId across subscription groups.
  let last: Record<string, any> | undefined;
  for (const group of statuses?.data ?? []) {
    for (const tx of group?.lastTransactions ?? []) {
      if (tx?.originalTransactionId === originalTransactionId) {
        last = tx;
        break;
      }
    }
    if (last) break;
  }
  const status: number = last?.status ?? 0;
  const txInfo = decodeJwsPayload(last?.signedTransactionInfo);
  const renewalInfo = decodeJwsPayload(last?.signedRenewalInfo);

  const autoRenew = renewalInfo.autoRenewStatus === 1;
  const isTrial = txInfo.offerType === 1 || txInfo.type === "Auto-Renewable Subscription" && txInfo.offerType === 1;
  const isSandbox = (txInfo.environment ?? renewalInfo.environment) === "Sandbox";
  const expiresAt = isoOrNull(txInfo.expiresDate);
  const graceUntil = isoOrNull(renewalInfo.gracePeriodExpiresDate);

  let canonicalState: CanonicalState;
  switch (status) {
    case 1: // Active
      canonicalState = isTrial ? "trial" : autoRenew ? "active" : "active_non_renewing";
      break;
    case 2: // Expired
      canonicalState = "expired";
      break;
    case 3: // In billing retry — access already suspended (D6 inactive)
      canonicalState = "on_billing_retry";
      break;
    case 4: // In billing grace period — access alive (D6 active)
      canonicalState = "in_grace_period";
      break;
    case 5: // Revoked (refund / chargeback / family-sharing removal)
      canonicalState = "refunded";
      break;
    default:
      canonicalState = "pending";
  }

  // Ordering timestamp: prefer the transaction's Apple-signed signedDate; fall back to now.
  const latestEventTs = eventTsOverride ??
    isoOrNull(txInfo.signedDate) ??
    isoOrNull(renewalInfo.signedDate) ??
    new Date().toISOString();

  return {
    appUserId: txInfo.appAccountToken ?? originalTransactionId,
    tenantId: null,
    provider: "app_store",
    productId: txInfo.productId ?? "unknown",
    stableTxnId: originalTransactionId,
    canonicalState,
    expiresAt,
    willRenew: autoRenew && (canonicalState === "active" || canonicalState === "trial"),
    inGraceUntil: canonicalState === "in_grace_period" ? graceUntil : null,
    isSandbox,
    latestEventTs,
    rawStoreState: { status, productId: txInfo.productId, environment: txInfo.environment },
  };
}

/**
 * Google Play Developer API — purchases.subscriptionsv2.get response → CanonicalEvent.
 *
 * subscriptionState enum → canonical: ACTIVE ⇒ active/active_non_renewing (autoRenew off but
 * not yet expired), IN_GRACE_PERIOD ⇒ in_grace_period (active), ON_HOLD ⇒ on_billing_retry
 * (inactive), PAUSED ⇒ paused, CANCELED ⇒ active_non_renewing while still entitled else cancelled,
 * EXPIRED ⇒ expired, PENDING/UNSPECIFIED ⇒ pending. Sandbox = presence of testPurchase.
 */
export function googleToCanonical(
  sub: Record<string, any>,
  purchaseToken: string,
  appUserId: string,
  eventTsOverride?: string,
): CanonicalEvent {
  const line = (sub?.lineItems ?? [])[0] ?? {};
  const expiresAt = line.expiryTime ? new Date(line.expiryTime).toISOString() : null;
  const autoRenew = line?.autoRenewingPlan?.autoRenewEnabled === true;
  const notExpired = expiresAt !== null && new Date(expiresAt).getTime() > Date.now();
  const isSandbox = sub?.testPurchase !== undefined && sub?.testPurchase !== null;

  let canonicalState: CanonicalState;
  switch (sub?.subscriptionState) {
    case "SUBSCRIPTION_STATE_ACTIVE":
      canonicalState = autoRenew ? "active" : "active_non_renewing";
      break;
    case "SUBSCRIPTION_STATE_IN_GRACE_PERIOD":
      canonicalState = "in_grace_period";
      break;
    case "SUBSCRIPTION_STATE_ON_HOLD":
      canonicalState = "on_billing_retry";
      break;
    case "SUBSCRIPTION_STATE_PAUSED":
      canonicalState = "paused";
      break;
    case "SUBSCRIPTION_STATE_CANCELED":
      // Canceled = auto-renew off; still entitled until expiryTime, then expired.
      canonicalState = notExpired ? "active_non_renewing" : "cancelled";
      break;
    case "SUBSCRIPTION_STATE_EXPIRED":
      canonicalState = "expired";
      break;
    case "SUBSCRIPTION_STATE_PENDING":
    case "SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED":
      canonicalState = "pending";
      break;
    default:
      canonicalState = "pending";
  }

  const latestEventTs = eventTsOverride ??
    (line.expiryTime ? new Date(line.expiryTime).toISOString() : null) ??
    new Date().toISOString();

  return {
    appUserId,
    tenantId: null,
    provider: "google_play",
    productId: line.productId ?? "unknown",
    stableTxnId: purchaseToken,
    canonicalState,
    expiresAt,
    willRenew: autoRenew && canonicalState === "active",
    inGraceUntil: canonicalState === "in_grace_period" ? expiresAt : null,
    isSandbox,
    latestEventTs,
    rawStoreState: { subscriptionState: sub?.subscriptionState, productId: line.productId },
  };
}
