// supabase/functions/subscription-change/index.ts
//
// POST /functions/v1/subscription-change?apiKey=pk_live_…   { token: <device token>, plan: <target sku> }
//   → 200 { plan, effective: "now" | <ISO date>, cancelled?: <sku> } | 4xx/501 { error }
//   Re-choosing the current plan while a change is scheduled cancels that change (cancelled = the dropped sku).
//
// Moves a subscriber to another plan of the same app (Plus → Pro → Max) on the SAME provider subscription
// (migration 197). Without it, a second checkout created a second subscription that billed alongside the first.
//   Stripe   — the single item's price is swapped with proration_behavior=always_invoice: an upgrade is charged
//              the prorated difference now, a downgrade becomes a credit on the next invoice; effective now.
//   Razorpay — the plan is swapped at the end of the current cycle (mid-cycle proration is not documented);
//              the member keeps their plan until then. PayCraft records the pending plan, so the monthly
//              grant follows the plan the member pays for even though renewal webhooks carry the old SKU.
// Other providers (stores) change plans in the store's own UI → 501.
//
// The caller is the device token's account (same identity rule as the allowance RPCs); the tenant's PSP secret
// is resolved server-side and never returned.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.1";
import { RateLimitError, rateLimitResponse, requireRateLimit } from "../_shared/rate-limit.ts";
import { preflight, withCors } from "../_shared/cors.ts";
import { pickByCurrency } from "../checkout-initiate/stripe-session.ts";
import { changeKind, currencyOf, razorpayChangeBody, refusal, stripeChangeForm } from "./change.ts";

const RAZORPAY_API = "https://api.razorpay.com/v1";
const STRIPE_API = "https://api.stripe.com/v1";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
}

export async function handleSubscriptionChange(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const apiKey = new URL(req.url).searchParams.get("apiKey");
  if (!apiKey) return json({ error: "missing_apiKey" }, 400);
  const body = (await req.json().catch(() => ({}))) as { token?: unknown; plan?: unknown };
  const token = typeof body.token === "string" ? body.token : "";
  const sku = typeof body.plan === "string" ? body.plan : "";
  if (!token || !sku) return json({ error: "token and plan are required" }, 400);

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: tenantId } = await supabase.rpc("resolve_tenant", { p_api_key: apiKey });
  if (!tenantId) return json({ error: "invalid_apiKey" }, 401);
  try {
    // Every call changes a real subscription at a PSP: as tight as checkout-initiate.
    await requireRateLimit(supabase, tenantId, req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown", "subscription_change", 10, 0.2);
  } catch (e) {
    if (e instanceof RateLimitError) return rateLimitResponse(e);
    throw e;
  }

  const { data: callerRows, error: callerErr } = await supabase.rpc("subscription_change_caller", { p_server_token: token, p_api_key: apiKey });
  if (callerErr) return json({ error: "invalid_token" }, 401);
  const sub = (callerRows as Record<string, any>[] | null)?.[0] ?? null;
  const columns = "sku, type, stripe_price_id_by_currency, stripe_price_id_by_currency_test, razorpay_plan_id_by_currency, razorpay_plan_id_by_currency_test, live_stripe_ids_verified";
  const { data: target } = await supabase.from("tenant_products").select(columns).eq("tenant_id", tenantId).eq("sku", sku).eq("active", true).maybeSingle();
  const refused = refusal(sub as never, sku, target as never);
  if (refused) return json({ error: refused.error }, refused.status);

  const mode = sub!.mode === "test" ? "test" : "live";
  const { data: current } = await supabase.from("tenant_products").select(columns).eq("tenant_id", tenantId).eq("sku", sub!.plan).maybeSingle();
  const { data: keys } = await supabase.rpc("tenant_psp_credential_resolve", { p_tenant_id: tenantId, p_provider: sub!.provider, p_mode: mode }).single();
  const k = keys as { key_id?: string; secret_key?: string } | null;
  if (!k?.secret_key) return json({ error: `${sub!.provider} ${mode} credentials not configured for this tenant` }, 409);

  // Keep my plan: the member re-chose their current plan while a cycle-end change is scheduled (Razorpay) — cancel
  // that change at the provider, then clear the pending plan. Stripe changes are immediate, so only the record clears.
  if (changeKind(sub as never, sku) === "cancel-scheduled") {
    if (sub!.provider === "razorpay") {
      const cres = await fetch(`${RAZORPAY_API}/subscriptions/${encodeURIComponent(sub!.provider_subscription_id)}/cancel_scheduled_changes`, {
        method: "POST",
        headers: { Authorization: "Basic " + btoa(`${k.key_id}:${k.secret_key}`) },
      });
      if (!cres.ok) return json({ error: "provider_change_failed", detail: ((await cres.json().catch(() => ({}))) as { error?: { description?: string } }).error?.description ?? null }, 502);
    }
    await supabase.rpc("subscription_set_pending_plan", { p_subscription_id: sub!.subscription_id, p_plan: sub!.plan, p_changes_at: null });
    return json({ plan: sub!.plan, effective: "now", cancelled: sub!.pending_plan });
  }

  if (sub!.provider === "stripe") {
    if (mode === "live" && (target as Record<string, unknown>).live_stripe_ids_verified === false) return json({ error: "live Stripe prices are not verified for this product — run a live Stripe sync" }, 409);
    const auth = { Authorization: `Bearer ${k.secret_key}` };
    const sres = await fetch(`${STRIPE_API}/subscriptions/${encodeURIComponent(sub!.provider_subscription_id)}`, { headers: auth });
    if (!sres.ok) return json({ error: "provider_lookup_failed" }, 502);
    const s = (await sres.json()) as { items?: { data?: { id: string; price?: { currency?: string } }[] } };
    const item = s.items?.data?.[0];
    if (!item || (s.items?.data?.length ?? 0) !== 1) return json({ error: "change_unsupported_for_provider" }, 501);
    const priceMap = (mode === "test" ? target!.stripe_price_id_by_currency_test : target!.stripe_price_id_by_currency) as Record<string, string>;
    const price = pickByCurrency(priceMap, item.price?.currency ?? null, `${mode} Stripe price`);
    if ("error" in price) return json({ error: price.error }, 409);
    const ures = await fetch(`${STRIPE_API}/subscriptions/${encodeURIComponent(sub!.provider_subscription_id)}`, {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": `change:${sub!.subscription_id}:${sku}` },
      body: stripeChangeForm(item.id, price.id, sku),
    });
    if (!ures.ok) return json({ error: "provider_change_failed", detail: ((await ures.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? null }, 502);
    await supabase.rpc("subscription_set_pending_plan", { p_subscription_id: sub!.subscription_id, p_plan: sku, p_changes_at: null });
    return json({ plan: sku, effective: "now" });
  }

  // Razorpay
  const rauth = { Authorization: "Basic " + btoa(`${k.key_id}:${k.secret_key}`) };
  const rres = await fetch(`${RAZORPAY_API}/subscriptions/${encodeURIComponent(sub!.provider_subscription_id)}`, { headers: rauth });
  if (!rres.ok) return json({ error: "provider_lookup_failed" }, 502);
  const rs = (await rres.json()) as { plan_id?: string; payment_method?: string };
  if (rs.payment_method === "emandate") return json({ error: "change_unsupported_for_provider" }, 501); // Razorpay refuses updates on e-mandates
  const curMap = (mode === "test" ? current?.razorpay_plan_id_by_currency_test : current?.razorpay_plan_id_by_currency) as Record<string, string> | null;
  const tgtMap = (mode === "test" ? target!.razorpay_plan_id_by_currency_test : target!.razorpay_plan_id_by_currency) as Record<string, string> | null;
  const plan = pickByCurrency(tgtMap, currencyOf(curMap, rs.plan_id ?? ""), `${mode} Razorpay plan`);
  if ("error" in plan) return json({ error: plan.error }, 409);
  const pres = await fetch(`${RAZORPAY_API}/subscriptions/${encodeURIComponent(sub!.provider_subscription_id)}`, {
    method: "PATCH",
    headers: { ...rauth, "Content-Type": "application/json" },
    body: JSON.stringify(razorpayChangeBody(plan.id)),
  });
  if (!pres.ok) return json({ error: "provider_change_failed", detail: ((await pres.json().catch(() => ({}))) as { error?: { description?: string } }).error?.description ?? null }, 502);
  await supabase.rpc("subscription_set_pending_plan", { p_subscription_id: sub!.subscription_id, p_plan: sku, p_changes_at: sub!.current_period_end });
  return json({ plan: sku, effective: sub!.current_period_end });
}

// CONFIG_SKIP_SERVE mirrors the /config test harness: importing this module in a test must not bind a port.
if (!Deno.env.get("CONFIG_SKIP_SERVE")) {
  Deno.serve(async (req) => withCors(await handleSubscriptionChange(req)));
}
