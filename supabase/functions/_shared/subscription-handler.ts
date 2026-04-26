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
}

export async function handleSubscriptionEvent(data: SubscriptionEvent) {
  console.log(`Processing subscription event: provider=${data.provider}, sub=${data.subscriptionId}, status=${data.status}`);

  if (data.email) {
    // Full upsert — we have the email (checkout completed)
    const { error } = await supabase.from("subscriptions").upsert(
      {
        email: data.email.toLowerCase(),
        provider: data.provider,
        provider_customer_id: data.customerId,
        provider_subscription_id: data.subscriptionId,
        plan: data.plan || "unknown",
        status: data.status,
        current_period_start: data.periodStart?.toISOString(),
        current_period_end: data.periodEnd?.toISOString(),
        cancel_at_period_end: data.cancelAtPeriodEnd,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "email" }
    );
    if (error) {
      console.error("Upsert error:", error);
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

    const { error } = await supabase
      .from("subscriptions")
      .update(updateData)
      .eq("provider_subscription_id", data.subscriptionId);

    if (error) {
      console.error("Update error:", error);
      throw new Error(`DB update failed: ${error.message}`);
    }
    console.log(`Subscription updated: ${data.subscriptionId} → ${data.status}`);
  }
}
