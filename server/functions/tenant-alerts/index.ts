import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  sendEmail,
  limitWarningEmail,
  limitHitEmail,
  webhookFailEmail,
  subscriptionExpiryEmail,
} from "../_shared/email.ts";

/**
 * Tenant Alerts — scheduled Edge Function that checks alert conditions
 * and sends email notifications via Resend.
 *
 * Run via cron (pg_cron or Supabase scheduled function) every hour.
 * Also callable manually: POST /functions/v1/tenant-alerts
 *
 * Alert types:
 *   - limit_warn: tenant at 80%+ of subscriber limit
 *   - limit_hit: tenant at 100% of subscriber limit
 *   - webhook_fail: 5+ consecutive webhook failures
 *   - sub_expiry: PayCraft Cloud subscription expires within 7 days
 */

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const LIMIT_WARN_THRESHOLD = 0.8;  // 80%
const WEBHOOK_FAIL_THRESHOLD = 5;  // consecutive failures
const EXPIRY_WARN_DAYS = 7;
const DEDUP_HOURS = 24;            // don't re-send same alert within 24h

serve(async (_req) => {
  const results = { limit_warn: 0, limit_hit: 0, webhook_fail: 0, sub_expiry: 0, skipped: 0 };

  try {
    // Fetch all active tenants with their alert prefs
    const { data: tenants, error: tErr } = await supabase
      .from("tenants")
      .select(`
        id, name, owner_email, plan, subscriber_limit,
        stripe_subscription_id, billing_period_end,
        tenant_alert_prefs (limit_warn, limit_hit, webhook_fail, sub_expiry)
      `)
      .eq("status", "active");

    if (tErr) throw new Error(`Fetch tenants: ${tErr.message}`);
    if (!tenants?.length) {
      return jsonResponse({ message: "No active tenants", results });
    }

    for (const tenant of tenants) {
      const prefs = tenant.tenant_alert_prefs?.[0] || tenant.tenant_alert_prefs;
      if (!prefs || !tenant.owner_email) continue;

      // ── Check subscriber limit ──
      if (prefs.limit_warn || prefs.limit_hit) {
        const { count } = await supabase
          .from("subscriptions")
          .select("*", { count: "exact", head: true })
          .eq("tenant_id", tenant.id)
          .eq("mode", "live")
          .in("status", ["active", "trialing"]);

        const current = count || 0;
        const ratio = current / tenant.subscriber_limit;

        if (ratio >= 1.0 && prefs.limit_hit) {
          if (await canSend(tenant.id, "limit_hit")) {
            const email = limitHitEmail(tenant.name, tenant.subscriber_limit);
            email.to = tenant.owner_email;
            const sent = await sendEmail(email);
            await logAlert(tenant.id, "limit_hit", tenant.owner_email, sent.id);
            results.limit_hit++;
          } else { results.skipped++; }
        } else if (ratio >= LIMIT_WARN_THRESHOLD && prefs.limit_warn) {
          if (await canSend(tenant.id, "limit_warn")) {
            const email = limitWarningEmail(tenant.name, current, tenant.subscriber_limit);
            email.to = tenant.owner_email;
            const sent = await sendEmail(email);
            await logAlert(tenant.id, "limit_warn", tenant.owner_email, sent.id);
            results.limit_warn++;
          } else { results.skipped++; }
        }
      }

      // ── Check consecutive webhook failures ──
      if (prefs.webhook_fail) {
        const { data: recentLogs } = await supabase
          .from("webhook_logs")
          .select("status")
          .eq("tenant_id", tenant.id)
          .order("created_at", { ascending: false })
          .limit(WEBHOOK_FAIL_THRESHOLD);

        const consecutive = recentLogs?.every((l: any) => l.status === "failed");
        if (consecutive && recentLogs && recentLogs.length >= WEBHOOK_FAIL_THRESHOLD) {
          if (await canSend(tenant.id, "webhook_fail")) {
            // Get last error message
            const { data: lastFailed } = await supabase
              .from("webhook_logs")
              .select("error_message")
              .eq("tenant_id", tenant.id)
              .eq("status", "failed")
              .order("created_at", { ascending: false })
              .limit(1)
              .single();

            const email = webhookFailEmail(
              tenant.name,
              WEBHOOK_FAIL_THRESHOLD,
              lastFailed?.error_message || "Unknown error"
            );
            email.to = tenant.owner_email;
            const sent = await sendEmail(email);
            await logAlert(tenant.id, "webhook_fail", tenant.owner_email, sent.id);
            results.webhook_fail++;
          } else { results.skipped++; }
        }
      }

      // ── Check PayCraft Cloud subscription expiry ──
      if (prefs.sub_expiry && tenant.billing_period_end && tenant.plan !== "free") {
        const periodEnd = new Date(tenant.billing_period_end);
        const now = new Date();
        const daysLeft = Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

        if (daysLeft > 0 && daysLeft <= EXPIRY_WARN_DAYS) {
          if (await canSend(tenant.id, "sub_expiry")) {
            const email = subscriptionExpiryEmail(tenant.name, daysLeft);
            email.to = tenant.owner_email;
            const sent = await sendEmail(email);
            await logAlert(tenant.id, "sub_expiry", tenant.owner_email, sent.id);
            results.sub_expiry++;
          } else { results.skipped++; }
        }
      }
    }
  } catch (err: any) {
    console.error("Tenant alerts error:", err);
    return jsonResponse({ error: err.message, results }, 500);
  }

  console.log("Tenant alerts complete:", results);
  return jsonResponse({ message: "Alerts processed", results });
});

/** Check if we already sent this alert type to this tenant within DEDUP_HOURS. */
async function canSend(tenantId: string, alertType: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - DEDUP_HOURS * 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("tenant_alert_log")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("alert_type", alertType)
    .gte("sent_at", cutoff);

  return (count || 0) === 0;
}

/** Log the alert for dedup and audit. */
async function logAlert(tenantId: string, alertType: string, recipient: string, resendId?: string) {
  try {
    await supabase.from("tenant_alert_log").insert({
      tenant_id: tenantId,
      alert_type: alertType,
      recipient,
      resend_id: resendId || null,
    });
  } catch (err) {
    console.error("Failed to log alert:", err);
  }
}

function jsonResponse(body: Record<string, any>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
