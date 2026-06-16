import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

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
