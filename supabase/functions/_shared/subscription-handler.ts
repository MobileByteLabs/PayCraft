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
  status: "active" | "canceled" | "past_due" | "unpaid" | string;
  periodStart: Date | null;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /** "test" for sk_test_ keys, "live" for sk_live_ keys. Prevents sandbox rows affecting is_premium() in production. */
  mode: "test" | "live";
  /** Tenant ID from webhook URL path. NULL = single-tenant (self-hosted). */
  tenantId: string | null;
  /** Stripe event type for webhook logging. */
  eventType?: string;
}

export async function handleSubscriptionEvent(data: SubscriptionEvent) {
  const startTime = Date.now();
  console.log(`Processing subscription event: provider=${data.provider}, sub=${data.subscriptionId}, status=${data.status}, tenant=${data.tenantId || "self-hosted"}`);

  let logStatus: "success" | "failed" = "success";
  let logError: string | null = null;

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
    } else {
      // Partial update — by subscription ID (renewals, cancellations)
      const updateData: Record<string, any> = {
        status: data.status,
        cancel_at_period_end: data.cancelAtPeriodEnd,
        updated_at: new Date().toISOString(),
      };
      if (data.periodStart) updateData.current_period_start = data.periodStart.toISOString();
      if (data.periodEnd) updateData.current_period_end = data.periodEnd.toISOString();

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
