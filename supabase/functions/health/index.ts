import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.1";
import { type Check, healthResponse, stripeCheck } from "../_shared/health.ts";
import { alertOnTransitions } from "../_shared/ops-alerts.ts";

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

serve(async () => {
  const [db, stripe_live, webhook_failures] = await Promise.all([
    dbCheck(),
    liveStripeKeys().then((k) => stripeCheck(k)),
    webhookFailureCheck(),
  ]);
  const checks = { db, stripe_live, webhook_failures };
  await alertOnTransitions(checks);
  return healthResponse(checks);
});
