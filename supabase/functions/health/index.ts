import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.1";
import { type Check, healthResponse, type IncidentStore, recordTransitions, stripeCheck } from "../_shared/health.ts";
import { sendEmail } from "../_shared/email.ts";

/**
 * GET /functions/v1/health — public, unauthenticated, for uptime monitors (.github/workflows/health-check.yml
 * polls it; any external monitor can too). 200 = healthy, 503 = something a paying customer would feel.
 *
 *   db               the database answers
 *   stripe_live      every live Stripe account has delivered all its events (see _shared/health.ts)
 *   webhook_failures no provider webhook failed processing in the last hour (all providers, from webhook_logs)
 *
 * Test mode is deliberately not checked: a broken sandbox should not page anyone.
 *
 * Every poll also records state CHANGES (migration 185): a check that starts failing opens an incident
 * and emails the platform owner (+ OPS_ALERT_EMAILS, comma-separated) once; recovery emails again.
 * /admin/health on the dashboard shows the open and past incidents.
 */
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

async function dbCheck(): Promise<Check> {
  const { error } = await supabase.from("tenants").select("id").limit(1);
  return error ? { ok: false, detail: `database error: ${error.message}` } : { ok: true, detail: "reachable" };
}

async function liveStripeKeys(): Promise<string[]> {
  const { data: rows } = await supabase
    .from("tenant_providers").select("tenant_id").eq("provider", "stripe").eq("is_active", true);
  const keys = [Deno.env.get("STRIPE_LIVE_SECRET_KEY") || Deno.env.get("STRIPE_SECRET_KEY") || ""];
  for (const r of rows ?? []) {
    const { data } = await supabase
      .rpc("tenant_providers_decrypt_for_webhook", { p_tenant_id: r.tenant_id, p_provider: "stripe", p_mode: "live" })
      .maybeSingle<{ secret_key: string | null }>();
    if (data?.secret_key) keys.push(data.secret_key);
  }
  return keys;
}

async function webhookFailureCheck(): Promise<Check> {
  const since = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from("webhook_logs").select("id", { count: "exact", head: true })
    .eq("status", "failed").eq("mode", "live").gte("created_at", since);
  if (error) return { ok: false, detail: `webhook_logs error: ${error.message}` };
  return count ? { ok: false, detail: `${count} live webhook(s) failed in the last hour` } : { ok: true, detail: "none in the last hour" };
}

const incidents: IncidentStore = {
  open: async (check, detail) => {
    const { data, error } = await supabase.rpc("health_incident_open", { p_check: check, p_detail: detail });
    if (error) throw new Error(error.message);
    return data === true;
  },
  resolve: async (check) => {
    const { data, error } = await supabase.rpc("health_incident_resolve", { p_check: check });
    if (error) throw new Error(error.message);
    return data ? new Date(data as string) : null;
  },
};

/** The platform owner (platform_settings, migration 053) plus OPS_ALERT_EMAILS. */
async function alertRecipients(): Promise<string[]> {
  const extra = (Deno.env.get("OPS_ALERT_EMAILS") || "").split(",").map((e) => e.trim()).filter(Boolean);
  const { data: settings } = await supabase.from("platform_settings").select("platform_owner_user_id").maybeSingle();
  if (settings?.platform_owner_user_id) {
    const { data } = await supabase.auth.admin.getUserById(settings.platform_owner_user_id);
    if (data?.user?.email) extra.push(data.user.email);
  }
  return [...new Set(extra)];
}

const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);

// Alerts send from ALERT_FROM_EMAIL when set: PAYCRAFT_FROM_EMAIL's domain must be verified in Resend, and
// an alert that cannot leave is worse than none. Every recipient is tried — one rejected address (Resend
// refuses unverified-domain mail to anyone but its account owner) must not silence the others.
const ALERT_FROM = Deno.env.get("ALERT_FROM_EMAIL") || undefined;

async function notify(subject: string, text: string): Promise<void> {
  const to = await alertRecipients();
  if (to.length === 0) throw new Error("no alert recipient: no platform owner and OPS_ALERT_EMAILS unset");
  const html = `<pre style="font:14px/1.5 monospace">${escapeHtml(text)}</pre>`;
  const results = await Promise.all(to.map((addr) => sendEmail({ to: addr, subject, html, from: ALERT_FROM })));
  const delivered = results.filter((r) => r.ok).length;
  if (delivered === 0) throw new Error(`alert reached no recipient: ${results.map((r) => r.error).join("; ")}`);
}

serve(async () => {
  const [db, stripe_live, webhook_failures] = await Promise.all([
    dbCheck(),
    liveStripeKeys().then((k) => stripeCheck(k)),
    webhookFailureCheck(),
  ]);
  const checks = { db, stripe_live, webhook_failures };
  await recordTransitions(checks, incidents, notify);
  return healthResponse(checks);
});
