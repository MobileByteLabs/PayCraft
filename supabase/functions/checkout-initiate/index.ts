// supabase/functions/checkout-initiate/index.ts
//
// POST /functions/v1/checkout-initiate?apiKey=pk_live_…
//
// Mint a per-customer checkout for a product the SDK cannot construct a URL for on its own.
//
// WHY THIS EXISTS
// A Razorpay recurring plan has NO reusable payment link, and that is by design: an auth link
// authorises ONE customer's mandate, so it carries their contact/email/name. At catalogue-sync time
// there is no customer, which is why product sync answers "The contact field is required for
// recurring links" and why `tenant_providers.live_payment_links` stays `{sku:{}}` for subscriptions
// no matter how often an operator re-syncs.
//
// The per-customer lane already existed — `dashboard/lib/razorpay-subscription-initiator.ts` creates
// the Subscription and returns its `short_url`, and `POST /api/checkout-initiate` calls it. But that
// route is gated by `requireTenant()`, a dashboard COOKIE SESSION, while the SDK holds a publishable
// api key. So the SDK could never reach it: it fell back to payment links a subscription will never
// have, and the paywall's Continue button threw "no checkout URL for currency INR" on device with
// nothing connecting the two facts.
//
// This is that lane, authenticated the way the SDK actually authenticates — the same
// `resolve_tenant(apiKey)` + per-tenant rate limit that `/config` uses.
//
// THE SECRET NEVER LEAVES THE SERVER. The tenant's Razorpay secret is decrypted here via
// `tenant_providers_decrypt_key` (SECURITY DEFINER, granted to service_role) and used to call
// Razorpay directly. It is never returned, never logged, and never reaches the client.
//
// RECONCILIATION IS ALREADY WIRED. The subscription is created with the notes the shipped
// `razorpay-webhook` reads — `paycraft_email`, `paycraft_plan`, `paycraft_mode`,
// `paycraft_tenant_id`, `paycraft_product_id` — so `subscription.authenticated` / `.charged` flow
// into the existing entitlement handler with no further work.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { RateLimitError, rateLimitResponse, requireRateLimit } from "../_shared/rate-limit.ts";

const RAZORPAY_API = "https://api.razorpay.com/v1";

interface CustomerInput {
  email?: string;
  name?: string | null;
  phone?: string | null;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}

/**
 * Pick the plan id for the buyer's currency.
 *
 * Falls back to the single configured plan when there is exactly one: a tenant with an INR-only
 * Razorpay account has one plan, and refusing to serve it because the header said `en-US` would be
 * pedantry — the account can only charge INR either way. Two or more plans and no match is a real
 * ambiguity, so it fails rather than guessing which currency to bill.
 */
function resolvePlanId(
  byCurrency: Record<string, string> | null,
  currency: string | null,
): { planId: string; currency: string } | { error: string } {
  const map = byCurrency ?? {};
  const keys = Object.keys(map);
  if (keys.length === 0) return { error: "product has no Razorpay plan — sync it to Razorpay first" };
  if (currency && map[currency.toUpperCase()]) {
    return { planId: map[currency.toUpperCase()], currency: currency.toUpperCase() };
  }
  if (keys.length === 1) return { planId: map[keys[0]], currency: keys[0] };
  return {
    error:
      `no Razorpay plan for currency ${currency ?? "(unspecified)"} — ` +
      `this product has plans for ${keys.join(", ")}`,
  };
}

/**
 * Charges to authorise, chosen to be ~10 years while staying inside Razorpay's per-period maximum.
 * Yearly is the one that bites: its cap is 100, not the 120 a monthly plan allows.
 */
function totalCountFor(interval: string): number {
  switch (interval) {
    case "year":
      return 100
    case "semiannual":
      return 20
    case "quarter":
      return 40
    default:
      return 120
  }
}

export async function handleCheckoutInitiate(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "access-control-allow-origin": "*",
        "access-control-allow-headers": "content-type, authorization",
        "access-control-allow-methods": "POST, OPTIONS",
      },
    });
  }
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = new URL(req.url);
  const apiKey = url.searchParams.get("apiKey") ?? "";
  if (!apiKey) return json({ error: "missing_apiKey" }, 400);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const sku = typeof body.sku === "string" ? body.sku : null;
  const productId = typeof body.product_id === "string" ? body.product_id : null;
  const customer = (body.customer ?? {}) as CustomerInput;
  const requestedCurrency = typeof body.currency === "string" ? body.currency : null;

  if (!sku && !productId) return json({ error: "sku or product_id is required" }, 400);
  // Razorpay notifies the customer on the mandate it is about to authorise, so an address is not
  // optional here — and a blank one produces a subscription nobody can complete.
  if (!customer.email) return json({ error: "customer.email is required" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: tenantId, error: resolveErr } = await supabase.rpc("resolve_tenant", {
    p_api_key: apiKey,
  });
  if (resolveErr || !tenantId) return json({ error: "invalid_apiKey" }, 401);

  const ipAddress = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown";
  try {
    // Deliberately tighter than /config's 60/s: this mints a real payment object at a PSP on every
    // call, so a loose limit would let one leaked publishable key spray subscriptions.
    await requireRateLimit(supabase, tenantId, ipAddress, "checkout_initiate", 10, 0.2);
  } catch (e) {
    if (e instanceof RateLimitError) return rateLimitResponse(e);
    throw e;
  }

  // Same resolution order as /config — see the comment there. `x-paycraft-mode` first (one key per
  // app, so the prefix carries no mode), then the legacy `pk_test_` prefix, then live.
  //
  // This one selects CREDENTIALS, not just links, so getting it wrong charges a real card. The
  // default stays live for the same reason it does in /config: a silent test-mode checkout takes no
  // money and nothing surfaces the loss. A caller that wants test must say so.
  const modeHeader = req.headers.get("x-paycraft-mode")?.toLowerCase();
  const mode: "test" | "live" = modeHeader === "test" ? "test"
    : modeHeader === "live" ? "live"
    : apiKey.startsWith("pk_test_") ? "test" : "live";

  const productQuery = supabase
    .from("tenant_products")
    .select("id, sku, type, interval, trial_duration_days, razorpay_plan_id_by_currency, display_name")
    .eq("tenant_id", tenantId)
    .eq("active", true);
  const { data: product, error: productErr } = await (
    productId ? productQuery.eq("id", productId) : productQuery.eq("sku", sku!)
  ).maybeSingle();

  if (productErr) return json({ error: `product lookup failed: ${productErr.message}` }, 500);
  if (!product) return json({ error: "product_not_found" }, 404);
  if (product.type !== "subscription") {
    // One-time products DO have reusable payment links; the SDK already opens those directly and
    // routing them through here would create a second, divergent path to the same checkout.
    return json(
      { error: "product is not a subscription — use the payment link from /config for one-time products" },
      409,
    );
  }

  const resolved = resolvePlanId(
    product.razorpay_plan_id_by_currency as Record<string, string> | null,
    requestedCurrency,
  );
  if ("error" in resolved) return json({ error: resolved.error }, 409);

  // `tenant_psp_credential_resolve`, NOT `tenant_providers_decrypt_key`. The latter is the
  // DASHBOARD's wrapper and gates on `auth.uid()` membership, so it raises `forbidden` for a
  // service-role caller that has no user — which surfaced here as the misleading "razorpay live
  // credentials not configured for this tenant" while the credentials were present and correct.
  // The resolver underneath is service_role-granted and carries no uid check, because authorisation
  // on this path is the api key: `resolve_tenant` above already proved the caller owns this tenant.
  const { data: keys, error: keyErr } = await supabase
    .rpc("tenant_psp_credential_resolve", {
      p_tenant_id: tenantId,
      p_provider: "razorpay",
      p_mode: mode,
    })
    .single();
  const keyId = (keys as { key_id?: string } | null)?.key_id;
  const keySecret = (keys as { secret_key?: string } | null)?.secret_key;
  if (keyErr || !keyId || !keySecret) {
    return json({ error: `razorpay ${mode} credentials not configured for this tenant` }, 409);
  }

  // Razorpay's start_at is the FIRST CHARGE time, so a trial is expressed as the gap between now
  // and start_at rather than as a trial flag.
  const now = Math.floor(Date.now() / 1000);
  const trialDays = Number(product.trial_duration_days ?? 0);
  const startAt = trialDays > 0 ? now + trialDays * 86_400 : undefined;

  const payload: Record<string, unknown> = {
    plan_id: resolved.planId,
    // Razorpay caps total_count PER PERIOD, and the cap is not the same for all of them — a yearly
    // plan rejects anything above 100 with "Exceeds the maximum total_count (100) allowed for the
    // given period and interval". A single hardcoded 120 ("≈10 years of monthly billing") therefore
    // made every ANNUAL subscription impossible to create, which is the most valuable plan on the
    // paywall. Aim for ~10 years within each cap; the subscription auto-completes after this many
    // charges, so too small a number would quietly end a subscription the buyer believes is ongoing.
    total_count: totalCountFor(String(product.interval ?? "month")),
    customer_notify: 1,
    notify_info: {
      notify_email: customer.email,
      ...(customer.phone ? { notify_phone: customer.phone } : {}),
    },
    // Echoed back on every webhook — this is how razorpay-webhook routes the event to a tenant and
    // a subscriber without a separate lookup table.
    notes: {
      paycraft_tenant_id: tenantId,
      paycraft_product_id: product.id,
      paycraft_plan: product.sku,
      paycraft_email: customer.email,
      paycraft_mode: mode,
      // Omitted rather than sent blank. An empty string is a value Razorpay stores and echoes back
      // on every webhook, so downstream code cannot tell "no name given" from "name is empty".
      ...(customer.name ? { paycraft_customer_name: customer.name } : {}),
    },
  };
  if (startAt) payload.start_at = startAt;

  const rzpRes = await fetch(`${RAZORPAY_API}/subscriptions`, {
    method: "POST",
    headers: {
      Authorization: "Basic " + btoa(`${keyId}:${keySecret}`),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const rzpJson = await rzpRes.json().catch(() => ({}));

  if (!rzpRes.ok) {
    // Surface Razorpay's own description. A generic 500 here is what sent the last investigation
    // chasing credentials that were fine all along.
    const detail = rzpJson?.error?.description ?? `razorpay ${rzpRes.status}`;
    return json({ error: `razorpay: ${detail}`, provider: "razorpay" }, 502);
  }
  if (!rzpJson?.id || !rzpJson?.short_url) {
    return json({ error: "razorpay returned a subscription with no short_url" }, 502);
  }

  // Best-effort audit. A failure to write the log must not cost the buyer a checkout they can use.
  await supabase
    .rpc("audit_log_emit", {
      p_tenant_id: tenantId,
      p_actor_user_id: null,
      p_actor_type: "sdk",
      p_action: "checkout.initiated",
      p_resource: `tenant_products:id=${product.id}`,
      p_after: {
        provider: "razorpay",
        subscription_id: rzpJson.id,
        plan_id: resolved.planId,
        currency: resolved.currency,
        mode,
      },
    })
    .then(
      () => {},
      () => {},
    );

  return json({
    url: rzpJson.short_url,
    provider: "razorpay",
    method: "razorpay",
    currency: resolved.currency,
    subscription_id: rzpJson.id,
    status: rzpJson.status ?? "created",
  });
}

// CONFIG_SKIP_SERVE mirrors the /config test harness: importing this module in a test must not bind
// a port.
if (!Deno.env.get("CONFIG_SKIP_SERVE")) {
  Deno.serve(handleCheckoutInitiate);
}
