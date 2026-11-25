import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.1";
import { type AlertKind, type AlertSeverity, deliverAlert } from "../_shared/alert-channels.ts";
import {
  limitWarningEmail,
  limitHitEmail,
  webhookFailEmail,
  subscriptionExpiryEmail,
} from "../_shared/email.ts";

/**
 * Tenant Alerts — scheduled Edge Function that checks alert conditions and notifies the owner.
 *
 * Scheduled hourly by pg_cron (migration 211, `paycraft_tenant_alerts`).
 * Also callable manually: POST /functions/v1/tenant-alerts
 *
 * Delivery goes through the shared owner-alert sender (_shared/alert-channels.ts, migration 211): each alert
 * is stored in tenant_alerts first (24 h dedupe per tenant + kind, the tenant's per-kind toggle), then sent to
 * every channel the tenant enabled — email (these templates), Slack, the signed outbound webhook and the
 * dashboard inbox — with each send on the alert_deliveries ledger and retried by attempt-alerts.
 * tenant_alert_log keeps receiving a mirror row per alert for one release (rollback path) and still backs
 * canSend() as defence in depth.
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
            const sent = await recordAndDispatch(tenant, "limit_hit", "critical", email.subject, email.html,
              `${tenant.name} has reached its limit of ${tenant.subscriber_limit} subscribers. New subscribers cannot be added until you upgrade.`,
              { current, limit: tenant.subscriber_limit });
            if (sent) results.limit_hit++; else results.skipped++;
          } else { results.skipped++; }
        } else if (ratio >= LIMIT_WARN_THRESHOLD && prefs.limit_warn) {
          if (await canSend(tenant.id, "limit_warn")) {
            const email = limitWarningEmail(tenant.name, current, tenant.subscriber_limit);
            const sent = await recordAndDispatch(tenant, "limit_warn", "digest", email.subject, email.html,
              `${tenant.name} has ${current} of ${tenant.subscriber_limit} subscribers (${Math.round(ratio * 100)}% of its limit).`,
              { current, limit: tenant.subscriber_limit });
            if (sent) results.limit_warn++; else results.skipped++;
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

            const lastError = lastFailed?.error_message || "Unknown error";
            const email = webhookFailEmail(tenant.name, WEBHOOK_FAIL_THRESHOLD, lastError);
            const sent = await recordAndDispatch(tenant, "webhook_fail", "critical", email.subject, email.html,
              `The last ${WEBHOOK_FAIL_THRESHOLD} webhooks for ${tenant.name} all failed. Last error: ${lastError}`,
              { consecutive_failures: WEBHOOK_FAIL_THRESHOLD, last_error: lastError });
            if (sent) results.webhook_fail++; else results.skipped++;
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
            const sent = await recordAndDispatch(tenant, "sub_expiry", "digest", email.subject, email.html,
              `The PayCraft subscription for ${tenant.name} expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`,
              { days_left: daysLeft, billing_period_end: tenant.billing_period_end });
            if (sent) results.sub_expiry++; else results.skipped++;
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

/**
 * Store the alert and fan it out to every enabled channel. False when tenant_alerts already holds this kind
 * for the tenant within 24 h (or the tenant turned it off) — nothing was sent. The tenant_alert_log mirror is
 * written only for an alert that was actually raised.
 */
async function recordAndDispatch(
  tenant: { id: string; owner_email: string },
  kind: AlertKind,
  severity: AlertSeverity,
  subject: string,
  html: string,
  text: string,
  payload: Record<string, unknown>,
): Promise<boolean> {
  const r = await deliverAlert(supabase, {
    tenantId: tenant.id, kind, severity, dedupeKey: kind, title: subject, body: text, bodyHtml: html, payload,
  });
  if (!r.alertId) return false;
  const failed = r.deliveries.filter((d) => !d.ok);
  if (failed.length) console.warn(`tenant-alerts ${tenant.id}/${kind}: ${failed.map((d) => `${d.channel}: ${d.error}`).join("; ")} (retried by attempt-alerts)`);
  await logAlert(tenant.id, kind, tenant.owner_email);
  return true;
}

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
async function logAlert(tenantId: string, alertType: string, recipient: string) {
  try {
    await supabase.from("tenant_alert_log").insert({
      tenant_id: tenantId,
      alert_type: alertType,
      recipient,
      resend_id: null,
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
