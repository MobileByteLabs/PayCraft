import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.1";
import { appleHistory, syncPlayTenant } from "../_shared/store-sync.ts";
import { subscriptionsv2Get, voidedPurchaseTokens } from "../_shared/play-api.ts";
import { tenantPlayDeveloperJwt } from "../_shared/play-jwt.ts";
import { tenantAppStoreServerJwt } from "../_shared/apple-jwt.ts";
import { processAppleNotification } from "../_shared/apple-notification.ts";
import { reconcileEntitlement } from "../_shared/entitlement-reconcile.ts";
import { alertOnTransitions } from "../_shared/ops-alerts.ts";
import type { Check } from "../_shared/health.ts";

/**
 * POST /functions/v1/store-sync[?days=N] — daily pull from Google Play and the App Store for every app
 * with that store connected (see _shared/store-sync.ts). Scheduled by pg_cron (migration 187) with the
 * service-role key; any other caller is refused. `days` widens the window for a manual backfill:
 * Google's voided list keeps 30 days (we ask for 29 — exactly 30 is refused), Apple's
 * notification history 180. Each app-store pair is also a health check: a sync that cannot reach a store
 * opens an incident and emails the owner (_shared/ops-alerts.ts), so it never fails silently.
 */
const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const DAY = 86_400_000;
const APPLE_HOSTS = { live: "https://api.storekit.itunes.apple.com", sandbox: "https://api.storekit-sandbox.itunes.apple.com" };

/** The gateway has verified the JWT; this checks it is the service role, not the public anon key. */
function isServiceRole(req: Request): boolean {
  const jwt = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  try {
    const payload = JSON.parse(atob(jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

async function appsWith(provider: string): Promise<Array<{ id: string; app_identifier: string }>> {
  const { data } = await supabase
    .from("tenant_providers")
    .select("tenant_id, tenants!inner(id, app_identifier, status)")
    .eq("provider", provider)
    .eq("is_active", true);
  // deno-lint-ignore no-explicit-any
  return (data ?? []).map((r: any) => r.tenants).filter((t: any) => t?.app_identifier && t.status === "active");
}

async function syncPlay(app: { id: string; app_identifier: string }, days: number) {
  const jwt = await tenantPlayDeveloperJwt(app.id);
  return await syncPlayTenant(app.id, {
    voidedTokens: () => voidedPurchaseTokens(app.app_identifier, jwt, Date.now() - Math.min(days, 29) * DAY),
    knownTokens: async (voided) => {
      // Not finished, or changed recently, plus every token Google just voided.
      const since = new Date(Date.now() - 35 * DAY).toISOString();
      const filters = [`canonical_state.not.in.(expired,refunded,cancelled)`, `updated_at.gte.${since}`];
      if (voided.length) filters.push(`stable_txn_id.in.(${voided.map((t) => `"${t}"`).join(",")})`);
      const { data, error } = await supabase
        .from("entitlement_records")
        .select("stable_txn_id, app_user_id")
        .eq("tenant_id", app.id)
        .eq("provider", "google_play")
        .or(filters.join(","))
        .limit(2000);
      if (error) throw new Error(`entitlement_records read failed: ${error.message}`);
      return (data ?? []).map((r) => ({ token: r.stable_txn_id, appUserId: r.app_user_id }));
    },
    truth: (token) => subscriptionsv2Get(app.app_identifier, token, jwt),
    reconcile: (ev) => reconcileEntitlement(ev, { preserveOwner: true }),
  });
}

async function syncApple(app: { id: string }, days: number) {
  const jwt = await tenantAppStoreServerJwt(app.id);
  const end = Date.now(), start = end - Math.min(days, 180) * DAY;
  let replayed = 0, errors = 0;
  const environments: Record<string, string> = {};
  // Each environment on its own: production answers 401 for an app that is not live on the App Store
  // yet while sandbox works with the SAME key, so one failing must not hide the other. Only BOTH failing
  // (a revoked / wrong key) is an error — that is what opens an incident.
  for (const [env, host] of Object.entries(APPLE_HOSTS)) {
    let payloads: string[];
    try {
      payloads = await appleHistory(host, jwt, start, end);
    } catch (e) {
      environments[env] = (e as Error).message.slice(0, 120);
      continue;
    }
    environments[env] = `${payloads.length} notification(s)`;
    for (const payload of payloads) {
      try {
        await processAppleNotification(payload);
        replayed++;
      } catch (e) {
        errors++;
        console.error(`[store-sync] apple notification failed: ${(e as Error).message}`);
      }
    }
  }
  if (Object.values(environments).every((v) => !v.includes("notification(s)"))) {
    throw new Error(`App Store unreachable in every environment — ${JSON.stringify(environments)}`);
  }
  return { replayed, errors, environments };
}

serve(async (req) => {
  if (!isServiceRole(req)) return new Response("service role only", { status: 403 });
  const days = Math.max(1, Number(new URL(req.url).searchParams.get("days")) || 2);
  const result: Record<string, unknown> = {};
  for (const app of await appsWith("google_play")) {
    try {
      result[`google_play:${app.app_identifier}`] = await syncPlay(app, days);
    } catch (e) {
      result[`google_play:${app.app_identifier}`] = { error: (e as Error).message };
    }
  }
  for (const app of await appsWith("app_store")) {
    try {
      result[`app_store:${app.app_identifier}`] = await syncApple(app, days);
    } catch (e) {
      result[`app_store:${app.app_identifier}`] = { error: (e as Error).message };
    }
  }
  console.log(`[store-sync] ${JSON.stringify(result)}`);
  // A store unreachable for an app is an incident; a single stale token is not (it is logged).
  const checks: Record<string, Check> = {};
  for (const [key, r] of Object.entries(result) as Array<[string, Record<string, unknown>]>) {
    checks[`store_sync:${key}`] = "error" in r
      ? { ok: false, detail: String(r.error).slice(0, 300) }
      : { ok: true, detail: JSON.stringify(r) };
  }
  await alertOnTransitions(checks);
  return new Response(JSON.stringify({ synced_at: new Date().toISOString(), result }), {
    headers: { "Content-Type": "application/json" },
  });
});
