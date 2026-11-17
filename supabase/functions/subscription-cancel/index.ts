// supabase/functions/subscription-cancel/index.ts
//
// POST /functions/v1/subscription-cancel?apiKey=pk_live_…   { token: <device token> }
//   → 200 { cancelled: true, ends_at: <ISO date> } | 4xx/501/502 { error }
//
// A member cancels their own web subscription (2026-11-17 — before this PayCraft had no cancel path, so apps
// could only say "cancel where you bought it", and a Stripe/Razorpay buyer had nowhere to do that).
//   Stripe   — cancel_at_period_end=true: no further renewals, the plan stays until the period ends.
//   Razorpay — cancel with cancel_at_cycle_end=1: same promise.
// PayCraft marks the row cancel_at_period_end; the provider's own webhook ends the subscription when the period
// runs out. Store subscriptions (Google Play / App Store) are cancelled in the store's UI → 501 cancel_in_store.
//
// Same identity rule as subscription-change: the device token's account; the tenant's PSP secret is resolved
// server-side and never returned.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.1";
import { RateLimitError, rateLimitResponse, requireRateLimit } from "../_shared/rate-limit.ts";
import { preflight, withCors } from "../_shared/cors.ts";
import { cancelRefusal, razorpayCancelBody, stripeCancelForm } from "./cancel.ts";

const RAZORPAY_API = "https://api.razorpay.com/v1";
const STRIPE_API = "https://api.stripe.com/v1";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
}

export async function handleSubscriptionCancel(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const apiKey = new URL(req.url).searchParams.get("apiKey");
  if (!apiKey) return json({ error: "missing_apiKey" }, 400);
  const body = (await req.json().catch(() => ({}))) as { token?: unknown };
  const token = typeof body.token === "string" ? body.token : "";
  if (!token) return json({ error: "token is required" }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: tenantId } = await supabase.rpc("resolve_tenant", { p_api_key: apiKey });
  if (!tenantId) return json({ error: "invalid_apiKey" }, 401);
  try {
    await requireRateLimit(supabase, tenantId, req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown", "subscription_cancel", 10, 0.2);
  } catch (e) {
    if (e instanceof RateLimitError) return rateLimitResponse(e);
    throw e;
  }

  // The caller's live subscription (197's lookup), plus whether a cancel is already pending.
  const { data: callerRows, error: callerErr } = await supabase.rpc("subscription_change_caller", { p_server_token: token, p_api_key: apiKey });
  if (callerErr) return json({ error: "invalid_token" }, 401);
  const caller = (callerRows as Record<string, any>[] | null)?.[0] ?? null;
  let sub: (Record<string, any> & { cancel_at_period_end: boolean | null }) | null = null;
  if (caller) {
    const { data: row } = await supabase.from("subscriptions").select("cancel_at_period_end").eq("id", caller.subscription_id).maybeSingle();
    sub = { ...caller, cancel_at_period_end: (row?.cancel_at_period_end as boolean | null) ?? false };
  }
  const refused = cancelRefusal(sub as never);
  if (refused) return json({ error: refused.error }, refused.status);

  const mode = sub!.mode === "test" ? "test" : "live";
  const { data: keys } = await supabase.rpc("tenant_psp_credential_resolve", { p_tenant_id: tenantId, p_provider: sub!.provider, p_mode: mode }).single();
  const k = keys as { key_id?: string; secret_key?: string } | null;
  if (!k?.secret_key) return json({ error: `${sub!.provider} ${mode} credentials not configured for this tenant` }, 409);

  const id = encodeURIComponent(sub!.provider_subscription_id);
  const res = sub!.provider === "stripe"
    ? await fetch(`${STRIPE_API}/subscriptions/${id}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${k.secret_key}`, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `cancel:${sub!.subscription_id}` },
      body: stripeCancelForm(),
    })
    : await fetch(`${RAZORPAY_API}/subscriptions/${id}/cancel`, {
      method: "POST",
      headers: { Authorization: "Basic " + btoa(`${k.key_id}:${k.secret_key}`), "Content-Type": "application/json" },
      body: JSON.stringify(razorpayCancelBody()),
    });
  if (!res.ok) {
    const e = (await res.json().catch(() => ({}))) as { error?: { message?: string; description?: string } };
    return json({ error: "provider_cancel_failed", detail: e.error?.message ?? e.error?.description ?? null }, 502);
  }

  await supabase.from("subscriptions").update({ cancel_at_period_end: true, updated_at: new Date().toISOString() }).eq("id", sub!.subscription_id);
  return json({ cancelled: true, ends_at: sub!.current_period_end });
}

// CONFIG_SKIP_SERVE mirrors the /config test harness: importing this module in a test must not bind a port.
if (!Deno.env.get("CONFIG_SKIP_SERVE")) {
  Deno.serve(async (req) => withCors(await handleSubscriptionCancel(req)));
}
