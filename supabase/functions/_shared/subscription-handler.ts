import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { reconcileEntitlement, type CanonicalState } from "./entitlement-reconcile.ts";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// E2: the 11 web providers all normalize into this SubscriptionEvent.status vocab; fold it onto
// the Phase-1 canonical machine (cmp-paycraft SubscriptionState). grace/on-hold correctness lives
// on the native (Apple/Play) path; web PSPs surface past_due (billing retry → inactive) and unpaid
// (dunning exhausted → expired). `active` + cancelAtPeriodEnd ⇒ active_non_renewing (still entitled).
export function mapWebStatusToCanonical(status: string, cancelAtPeriodEnd: boolean): CanonicalState {
  switch (status) {
    case "trialing":
      return "trial";
    case "active":
      return cancelAtPeriodEnd ? "active_non_renewing" : "active";
    case "past_due":
      return "on_billing_retry"; // billing issue → inactive
    case "unpaid":
      return "expired";
    case "canceled":
      return "cancelled";
    default:
      return "pending";
  }
}

interface SubscriptionEvent {
  email: string | null;
  provider: string;
  customerId: string | null;
  subscriptionId: string;
  plan: string | null;
  status: "active" | "canceled" | "past_due" | "unpaid" | "trialing" | string;
  periodStart: Date | null;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /** "test" for sk_test_ keys, "live" for sk_live_ keys. Prevents sandbox rows affecting is_premium() in production. */
  mode: "test" | "live";
  /** Tenant ID from webhook URL path. NULL = single-tenant (self-hosted). */
  tenantId: string | null;
  /** Stripe event type for webhook logging. */
  eventType?: string;
  /** Provider-emitted trial start. NULL when no trial. PayCraft v1.1 (AR-010, TR-001). */
  trialStart?: Date | null;
  /** Provider-emitted trial end. NULL when no trial. Client computes isInTrial from this. */
  trialEnd?: Date | null;
}

export async function handleSubscriptionEvent(data: SubscriptionEvent) {
  const startTime = Date.now();

  // Tenant fail-safe. A multi-tenant deployment MUST attribute the subscription to a
  // tenant, or check_premium_with_device()'s `tenant_id IS NOT DISTINCT FROM` filter
  // rejects it (NULL sub never matches a tenant-scoped device) and is_premium is silently
  // always-false. If the webhook URL omitted /{tenant_id} (data.tenantId===null) but this
  // provider is configured for exactly ONE tenant, attribute to it. If >1, reject rather
  // than write a NULL-tenant row. Zero provider-tenants ⇒ genuine single-tenant self-hosted
  // deployment ⇒ NULL is correct and preserved.
  if (!data.tenantId) {
    const { data: provRows } = await supabase
      .from("tenant_providers").select("tenant_id").eq("provider", data.provider);
    const tenantIds = [...new Set((provRows ?? []).map((r: any) => r.tenant_id).filter(Boolean))];
    if (tenantIds.length === 1) {
      data.tenantId = tenantIds[0];
      console.warn(`[subscription-handler] tenantId absent from webhook URL — attributed to sole ${data.provider} tenant ${data.tenantId}. Fix the webhook endpoint to /${data.provider}-webhook/{tenant_id}.`);
    } else if (tenantIds.length > 1) {
      throw new Error(`Ambiguous tenant: ${tenantIds.length} tenants have provider '${data.provider}'. Webhook URL must include /{tenant_id}.`);
    }
  }

  console.log(`Processing subscription event: provider=${data.provider}, sub=${data.subscriptionId}, status=${data.status}, tenant=${data.tenantId || "self-hosted"}`);

  let logStatus: "success" | "failed" = "success";
  let logError: string | null = null;

  // Fetch the pre-image row (best-effort) so we can populate `before_jsonb` in
  // the audit emit. Failure is non-fatal — we just emit with before=null.
  let beforeRow: Record<string, any> | null = null;
  try {
    let preQuery = supabase
      .from("subscriptions")
      .select("*")
      .eq("provider_subscription_id", data.subscriptionId)
      .limit(1);
    if (data.tenantId) preQuery = preQuery.eq("tenant_id", data.tenantId);
    const { data: rows } = await preQuery;
    if (rows && rows.length > 0) beforeRow = rows[0];
  } catch (_preErr) {
    // Swallow — pre-image is best-effort.
  }

  try {
    if (data.email) {
      // Full upsert — we have the email (checkout completed)
      const row: Record<string, any> = {
        email: data.email.toLowerCase(),
        provider: data.provider,
        provider_customer_id: data.customerId,
        provider_subscription_id: data.subscriptionId,
        plan: data.plan || "unknown",
        status: data.status,
        mode: data.mode,
        current_period_start: data.periodStart?.toISOString(),
        current_period_end: data.periodEnd?.toISOString(),
        cancel_at_period_end: data.cancelAtPeriodEnd,
        trial_start: data.trialStart?.toISOString() ?? null,
        trial_end: data.trialEnd?.toISOString() ?? null,
        updated_at: new Date().toISOString(),
      };
      if (data.tenantId) row.tenant_id = data.tenantId;

      const { error } = await supabase.from("subscriptions").upsert(row, {
        onConflict: data.tenantId ? "idx_subscriptions_tenant_email" : "email",
      });
      if (error) {
        throw new Error(`DB upsert failed: ${error.message}`);
      }
      console.log(`Subscription upserted for ${data.email}`);

      // AC-24: emit audit log row on successful upsert.
      await emitSubscriptionAudit(data, beforeRow, row);

      // E2: fold the web event onto the canonical entitlement record (D5 single SoT).
      await reconcileWebEntitlement(data, data.email.toLowerCase());
    } else {
      // Partial update — by subscription ID (renewals, cancellations)
      const updateData: Record<string, any> = {
        status: data.status,
        cancel_at_period_end: data.cancelAtPeriodEnd,
        updated_at: new Date().toISOString(),
      };
      if (data.periodStart) updateData.current_period_start = data.periodStart.toISOString();
      if (data.periodEnd) updateData.current_period_end = data.periodEnd.toISOString();
      // Trial fields: only update if provided. `undefined` skips; explicit `null` clears.
      // Provider may emit trial_end on subscription.updated when a trial is extended.
      if (data.trialStart !== undefined) {
        updateData.trial_start = data.trialStart?.toISOString() ?? null;
      }
      if (data.trialEnd !== undefined) {
        updateData.trial_end = data.trialEnd?.toISOString() ?? null;
      }

      let query = supabase
        .from("subscriptions")
        .update(updateData)
        .eq("provider_subscription_id", data.subscriptionId);

      // Scope to tenant if multi-tenant
      if (data.tenantId) {
        query = query.eq("tenant_id", data.tenantId);
      }

      const { error } = await query;

      if (error) {
        throw new Error(`DB update failed: ${error.message}`);
      }
      console.log(`Subscription updated: ${data.subscriptionId} → ${data.status}`);

      // AC-24: emit audit log row on successful update.
      await emitSubscriptionAudit(data, beforeRow, updateData);

      // E2: fold onto the canonical record. Preserve identity from the pre-image row so a
      // partial (no-email) update does not clobber app_user_id with a fallback.
      const appUserId = (beforeRow?.email as string | undefined)?.toLowerCase() ??
        data.customerId ?? data.subscriptionId;
      await reconcileWebEntitlement(data, appUserId);
    }
  } catch (err: any) {
    logStatus = "failed";
    logError = err.message;
    console.error("Subscription handler error:", err);
    // Re-throw after logging
    await logWebhookEvent(data, startTime, logStatus, logError);
    throw err;
  }

  await logWebhookEvent(data, startTime, logStatus, logError);
}

/**
 * AC-24 — Emit a tenant_audit_log row via the audit_log_emit() RPC after a
 * successful subscription upsert/update. Failure NEVER fails the webhook;
 * audit logging is best-effort observability, not transactional invariance.
 *
 * Action verb is derived from data.status:
 *   - "canceled"   → "subscription.cancel"
 *   - "trialing"   → "subscription.trial"
 *   - otherwise    → "subscription.upsert" (full upsert with email) or
 *                    "subscription.update" (partial update by sub id)
 */
export async function emitSubscriptionAudit(
  data: SubscriptionEvent,
  beforeRow: Record<string, any> | null,
  afterRow: Record<string, any>,
): Promise<void> {
  // Single-tenant rows (tenantId=null) cannot satisfy the NOT NULL tenant_id
  // FK on tenant_audit_log. Skip audit emit in self-hosted single-tenant mode.
  if (!data.tenantId) return;

  let action: string;
  if (data.status === "canceled") {
    action = "subscription.cancel";
  } else if (data.status === "trialing") {
    action = "subscription.trial";
  } else if (data.email) {
    action = "subscription.upsert";
  } else {
    action = "subscription.update";
  }

  const resource = data.email
    ? `subscriptions:email=${data.email.toLowerCase()}`
    : `subscriptions:provider_subscription_id=${data.subscriptionId}`;

  try {
    const { error } = await supabase.rpc("audit_log_emit", {
      p_tenant_id: data.tenantId,
      p_actor_user_id: null,
      p_actor_type: "webhook",
      p_action: action,
      p_resource: resource,
      p_before: beforeRow,
      p_after: afterRow,
      p_ip: null,
      p_user_agent: `${data.provider}-webhook`,
    });
    if (error) {
      console.error("audit_log_emit RPC error (non-fatal):", error.message);
    }
  } catch (auditErr) {
    // Audit failure must NEVER fail the webhook.
    console.error("audit_log_emit threw (non-fatal):", auditErr);
  }
}

/**
 * E2 — fold a successful web-provider subscription event onto the canonical entitlement_records
 * SoT (D5). Keyed idempotently by (provider, stable_txn_id=subscriptionId), out-of-order-safe via
 * the reconcile engine's latest_event_ts guard. Best-effort like audit emit: a reconcile failure
 * (e.g. entitlement_records not yet migrated in this env) is logged, never fails the webhook — the
 * legacy `subscriptions` gating path is unaffected.
 */
async function reconcileWebEntitlement(data: SubscriptionEvent, appUserId: string): Promise<void> {
  try {
    await reconcileEntitlement({
      appUserId,
      tenantId: data.tenantId,
      provider: data.provider,
      productId: data.plan ?? "unknown",
      stableTxnId: data.subscriptionId,
      canonicalState: mapWebStatusToCanonical(data.status, data.cancelAtPeriodEnd),
      expiresAt: data.periodEnd?.toISOString() ?? null,
      willRenew: !data.cancelAtPeriodEnd,
      inGraceUntil: null,
      isSandbox: data.mode === "test",
      latestEventTs: new Date().toISOString(),
      rawStoreState: { status: data.status, plan: data.plan, mode: data.mode },
    });
  } catch (reconcileErr) {
    // Reconcile must NEVER fail the webhook — the subscriptions table remains the live gating path.
    console.error("reconcileWebEntitlement threw (non-fatal):", (reconcileErr as Error).message);
  }
}

async function logWebhookEvent(
  data: SubscriptionEvent,
  startTime: number,
  status: "success" | "failed",
  errorMessage: string | null,
) {
  try {
    await supabase.from("webhook_logs").insert({
      tenant_id: data.tenantId,
      provider: data.provider,
      event_type: data.eventType || "unknown",
      status,
      payload_redacted: {
        subscription_id: data.subscriptionId,
        plan: data.plan,
        subscription_status: data.status,
        mode: data.mode,
        // Email redacted for security
        has_email: !!data.email,
      },
      error_message: errorMessage,
      processing_ms: Date.now() - startTime,
      mode: data.mode,
    });
  } catch (logErr) {
    // Never let logging failure break the webhook
    console.error("Failed to log webhook event:", logErr);
  }
}
