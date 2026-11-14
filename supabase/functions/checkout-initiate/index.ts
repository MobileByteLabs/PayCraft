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

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.1";
import { RateLimitError, rateLimitResponse, requireRateLimit } from "../_shared/rate-limit.ts";
import { preflight, withCors } from "../_shared/cors.ts";
import { pickByCurrency, returnUrls, stripeSessionForm } from "./stripe-session.ts";
import { razorpayCheckoutTarget } from "./razorpay-return.ts";
import { buyerRef, type OfferCoupon, offerUsable, type OfferRow } from "../_shared/winback-offer.ts";
import { effectiveTrial } from "../_shared/trial.ts";

const RAZORPAY_API = "https://api.razorpay.com/v1";
const STRIPE_API = "https://api.stripe.com/v1";

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

// Browser entry (cmp-paycraft-web): answer the CORS preflight, then add the CORS headers to
// every response — success and error alike — without touching the handler's own logic.
export async function handleCheckoutInitiate(req: Request): Promise<Response> {
  const pre = preflight(req);
  if (pre) return pre;
  try {
    return withCors(await handleCheckoutInitiateInner(req));
  } catch (e) {
    // An uncaught throw would otherwise reach the runtime as a bare 500 with no CORS headers,
    // which a browser reports as an opaque CORS failure instead of the real error.
    console.error("[checkout-initiate] unhandled", e);
    return withCors(
      new Response(JSON.stringify({ error: "internal_error" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    );
  }
}

async function handleCheckoutInitiateInner(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = new URL(req.url);
  const apiKey = url.searchParams.get("apiKey") ?? "";
  if (!apiKey) return json({ error: "missing_apiKey" }, 400);

  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const sku = typeof body.sku === "string" ? body.sku : null;
  const productId = typeof body.product_id === "string" ? body.product_id : null;
  const customer = (body.customer ?? {}) as CustomerInput;
  const requestedCurrency = typeof body.currency === "string" ? body.currency : null;
  // Which PSP the SDK routed this buyer to (the provider /config bound for their currency). Absent from
  // older SDKs, which only ever reached this lane for Razorpay.
  const provider = body.provider === "stripe" ? "stripe" : "razorpay";
  if (body.provider != null && body.provider !== "stripe" && body.provider !== "razorpay") {
    return json({ error: `provider ${String(body.provider)} has no server checkout` }, 400);
  }

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
    // One literal: supabase-js types the row from it (a concatenated string types it as an error).
    .select(
      "id, sku, type, interval, trial_enabled, trial_duration_days, razorpay_plan_id_by_currency, razorpay_plan_id_by_currency_test, display_name, stripe_price_id_by_currency, stripe_price_id_by_currency_test, live_stripe_ids_verified",
    )
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

  // A win-back offer (the exit survey's discount). Refused — not silently dropped — when it is not this
  // buyer's or no longer live: the buyer clicked "claim 50% off", so charging full price without saying so
  // would be worse than an error the SDK turns into "this offer has ended" before a normal checkout.
  let winback: { offer: OfferRow; coupon: OfferCoupon } | null = null;
  if (typeof body.offerId === "string" && body.offerId.length > 0) {
    winback = await usableOffer(supabase, tenantId, body.offerId, customer.email!, typeof body.deviceRef === "string" ? body.deviceRef : null);
    if (!winback) return json({ error: "offer_not_usable" }, 409);
  }

  if (provider === "stripe") {
    return await stripeCheckout(supabase, req, body, tenantId, mode, product, customer, requestedCurrency, winback);
  }

  // Plan ids are ACCOUNT-scoped per mode: a test key cannot see a live plan. Sending the live map in
  // test mode answered "The ID provided is invalid or could not be found", so no app could take a
  // test-mode Razorpay subscription — and no webhook round-trip could be proven without real money.
  const resolved = resolvePlanId(
    (mode === "test" ? product.razorpay_plan_id_by_currency_test : product.razorpay_plan_id_by_currency) as
      | Record<string, string>
      | null,
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
  const trialDays = effectiveTrial(product).days; // the rule /config advertises (_shared/trial.ts)
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
  if (winback?.coupon.razorpay_offer_id) {
    payload.offer_id = winback.coupon.razorpay_offer_id;
    (payload.notes as Record<string, unknown>).paycraft_winback_offer = winback.offer.id;
  }

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

  // Bring the buyer BACK to the site afterwards, as Stripe does with success_url: a browser checkout with a
  // valid return_url goes to PayCraft's pay page (Razorpay Checkout + redirect). Anything else — KMP apps,
  // a missing Origin, a return_url on another site — keeps the hosted short_url. See razorpay-return.ts.
  const target = razorpayCheckoutTarget({
    subscriptionId: rzpJson.id,
    shortUrl: rzpJson.short_url,
    tenantId,
    mode,
    keyId,
    payBase: Deno.env.get("PAYCRAFT_DASHBOARD_URL") || "https://paycraft.mobilebytesensei.com",
    returnUrl: typeof body.return_url === "string" ? body.return_url : null,
    origin: req.headers.get("origin"),
    email: customer.email ?? null,
    productName: (product.display_name as string | null) ?? product.sku,
  });
  let checkoutUrl = rzpJson.short_url;
  if (target.row) {
    // A failed write falls back to the hosted page: the buyer can still pay, they just are not returned.
    const { error: retErr } = await supabase.from("razorpay_checkout_returns").upsert(target.row);
    if (!retErr) checkoutUrl = target.url;
    else console.error("[checkout-initiate] razorpay return row:", retErr.message);
  }

  return json({
    url: checkoutUrl,
    provider: "razorpay",
    method: "razorpay",
    currency: resolved.currency,
    subscription_id: rzpJson.id,
    status: rzpJson.status ?? "created",
  });
}

/**
 * The Stripe lane: a per-customer Checkout Session for the product's Stripe price in the buyer's currency.
 * Pure parts (price pick, return urls, form) live in stripe-session.ts.
 */
async function stripeCheckout(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  req: Request,
  body: Record<string, unknown>,
  tenantId: string,
  mode: "test" | "live",
  // deno-lint-ignore no-explicit-any
  product: any,
  customer: CustomerInput,
  requestedCurrency: string | null,
  winback: { offer: OfferRow; coupon: OfferCoupon } | null,
): Promise<Response> {
  // Stripe ids are ACCOUNT-scoped per mode (migration 147). A live column not yet verified by a live
  // sync may still hold test ids, which would fail at Stripe with a confusing "No such price".
  if (mode === "live" && product.live_stripe_ids_verified === false) {
    return json({ error: "live Stripe prices are not verified for this product — run a live Stripe sync" }, 409);
  }
  const priceMap = (mode === "test" ? product.stripe_price_id_by_currency_test : product.stripe_price_id_by_currency) as
    | Record<string, string>
    | null;
  const price = pickByCurrency(priceMap, requestedCurrency, `${mode} Stripe price`);
  if ("error" in price) return json({ error: price.error }, 409);

  const back = returnUrls(typeof body.return_url === "string" ? body.return_url : null, req.headers.get("origin"));
  if ("error" in back) return json({ error: back.error }, 400);

  const { data: keys, error: keyErr } = await supabase
    .rpc("tenant_psp_credential_resolve", { p_tenant_id: tenantId, p_provider: "stripe", p_mode: mode })
    .single();
  const secret = (keys as { secret_key?: string } | null)?.secret_key;
  if (keyErr || !secret) return json({ error: `stripe ${mode} credentials not configured for this tenant` }, 409);

  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: stripeSessionForm({
      priceId: price.id,
      email: customer.email!,
      sku: product.sku,
      tenantId,
      productId: product.id,
      mode,
      trialDays: effectiveTrial(product).days,
      success: back.success,
      cancel: back.cancel,
      discount: winback
        ? { promotionCodeId: winback.coupon.stripe_promotion_code_id, couponId: winback.coupon.stripe_coupon_id }
        : null,
      winbackOfferId: winback?.offer.id ?? null,
    }),
  });
  const session = await res.json().catch(() => ({}));
  if (!res.ok) {
    return json({ error: `stripe: ${session?.error?.message ?? `stripe ${res.status}`}`, provider: "stripe" }, 502);
  }
  if (!session?.id || !session?.url) return json({ error: "stripe returned a session with no url" }, 502);

  await supabase
    .rpc("audit_log_emit", {
      p_tenant_id: tenantId,
      p_actor_user_id: null,
      p_actor_type: "sdk",
      p_action: "checkout.initiated",
      p_resource: `tenant_products:id=${product.id}`,
      p_after: { provider: "stripe", session_id: session.id, price_id: price.id, currency: price.currency, mode },
    })
    .then(
      () => {},
      () => {},
    );

  return json({
    url: session.url,
    provider: "stripe",
    method: "stripe",
    currency: price.currency,
    session_id: session.id,
    status: session.status ?? "open",
  });
}

// CONFIG_SKIP_SERVE mirrors the /config test harness: importing this module in a test must not bind
// a port.
if (!Deno.env.get("CONFIG_SKIP_SERVE")) {
  Deno.serve(handleCheckoutInitiate);
}

/**
 * The win-back offer [offerId] if THIS buyer may use it now — matched on their account (the checkout email) or the
 * device the offer was made to — and marks it applied. Null when it is someone else's, expired, redeemed, or its
 * coupon is no longer live.
 */
async function usableOffer(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tenantId: string,
  offerId: string,
  email: string,
  deviceRef: string | null,
): Promise<{ offer: OfferRow; coupon: OfferCoupon } | null> {
  const { data: offer } = await supabase.from("winback_offers")
    .select("id,tenant_id,user_ref,coupon_id,expires_at,redeemed_at").eq("id", offerId).eq("tenant_id", tenantId).maybeSingle();
  if (!offer) return null;
  const { data: coupon } = await supabase.from("tenant_coupons")
    .select("id,percent_off,duration,duration_in_months,active,redeem_by,max_redemptions,times_redeemed,stripe_coupon_id,stripe_promotion_code_id,razorpay_offer_id,googleplay_offer_ids,appstore_offer_ids")
    .eq("id", offer.coupon_id).maybeSingle();
  if (!coupon) return null;
  const refs = [await buyerRef(tenantId, email, null), deviceRef ? await buyerRef(tenantId, null, deviceRef) : null];
  if (!refs.some((r) => offerUsable(offer, coupon, tenantId, r))) return null;
  // applied_ref: the account this checkout runs as — the webhook marks the offer redeemed when it pays.
  await supabase.from("winback_offers").update({ applied_at: new Date().toISOString(), applied_ref: refs[0] }).eq("id", offer.id);
  return { offer, coupon };
}
