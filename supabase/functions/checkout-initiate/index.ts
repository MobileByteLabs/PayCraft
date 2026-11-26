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
//
// ATTEMPTS (migration 210). When the SDK sends `attempt_id`, this function opens that purchase attempt,
// forwards the id to the provider (Stripe `client_reference_id` + `metadata.attempt_id`, Razorpay
// `notes.attempt_id`) so the webhook closes the same record, moves it to `checkout_opened` on success and
// records every refusal on it (stage `server` for our own, `provider` when the PSP rejected the call).
// Without an id — an older SDK — nothing about the response changes.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.1";
import { RateLimitError, rateLimitResponse, requireRateLimit } from "../_shared/rate-limit.ts";
import { preflight, withCors } from "../_shared/cors.ts";
import { pickByCurrency, returnUrls, stripeSessionForm } from "./stripe-session.ts";
import { razorpaySubscriptionPayload } from "./razorpay-subscription.ts";
import { razorpayCheckoutTarget } from "./razorpay-return.ts";
import { buyerRef, type OfferCoupon, offerUsable, type OfferRow } from "../_shared/winback-offer.ts";
import { effectiveTrial } from "../_shared/trial.ts";
import {
  attemptBestEffort,
  closeAsFailed,
  normaliseAttemptId,
  openAttempt,
  transitionAttempt,
} from "../_shared/payment-attempts.ts";

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

/**
 * The attempt this checkout belongs to (migration 210), when the SDK named one. Every exit after the
 * attempt is opened goes through [refuse] so the reason lands on the attempt — stage `server` for a
 * refusal of our own (no product, no price, no credentials), `provider` when the PSP rejected the call.
 * Attempt bookkeeping is best-effort: it never costs the buyer a checkout or changes a response.
 */
interface CheckoutAttemptCtx {
  attemptId: string | null;
  refuse(
    status: number,
    body: Record<string, unknown>,
    failure: { stage: "server" | "provider"; code: string | number; message: string },
  ): Promise<Response>;
  opened(providerSessionId: string, providerSubscriptionId: string | null): Promise<void>;
}

function checkoutAttemptCtx(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  attemptId: string | null,
  provider: "stripe" | "razorpay",
): CheckoutAttemptCtx {
  return {
    attemptId,
    async refuse(status, body, failure) {
      if (attemptId) {
        await attemptBestEffort(`checkout-initiate fail ${attemptId}`, () =>
          closeAsFailed(supabase, attemptId, {
            stage: failure.stage,
            error_class: `${provider}_init`,
            error_code: failure.code,
            error_message: failure.message,
          }));
      }
      return json(body, status);
    },
    async opened(providerSessionId, providerSubscriptionId) {
      if (!attemptId) return;
      await attemptBestEffort(`checkout-initiate opened ${attemptId}`, () =>
        transitionAttempt(supabase, attemptId, "checkout_opened", {
          provider_session_id: providerSessionId,
          provider_subscription_id: providerSubscriptionId,
        }));
    },
  };
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
  // The SDK's purchase-attempt id (paycraft-attempt-observability). Optional — older SDKs send none and
  // keep working; a malformed one is refused rather than stored.
  const attemptId = normaliseAttemptId(body.attempt_id);
  if (body.attempt_id != null && !attemptId) {
    return json({ error: "attempt_id must be 1–100 characters of A–Z a–z 0–9 _ . : -" }, 400);
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

  // The attempt opens here — the app and the mode are known — so every refusal from now on is recorded
  // against it. A retried request finds it already open and leaves it as it is.
  if (attemptId) {
    await attemptBestEffort(`checkout-initiate open ${attemptId}`, () =>
      openAttempt(supabase, {
        attempt_id: attemptId,
        tenant_id: tenantId,
        provider,
        mode,
        email: customer.email!,
        plan: sku ?? null,
      }));
  }
  const attempt = checkoutAttemptCtx(supabase, attemptId, provider);
  try {
    return await checkoutForTenant(supabase, req, body, attempt, {
      tenantId, mode, provider, sku, productId, customer, requestedCurrency,
    });
  } catch (e) {
    // An unexpected throw is a server failure of this attempt too; the outer handler still answers 500.
    if (attemptId) {
      await attemptBestEffort(`checkout-initiate crash ${attemptId}`, () =>
        closeAsFailed(supabase, attemptId, {
          stage: "server",
          error_class: `${provider}_init`,
          error_code: "internal_error",
          error_message: (e as Error)?.message ?? String(e),
        }));
    }
    throw e;
  }
}

async function checkoutForTenant(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  req: Request,
  body: Record<string, unknown>,
  attempt: CheckoutAttemptCtx,
  c: {
    tenantId: string;
    mode: "test" | "live";
    provider: "stripe" | "razorpay";
    sku: string | null;
    productId: string | null;
    customer: CustomerInput;
    requestedCurrency: string | null;
  },
): Promise<Response> {
  const { tenantId, mode, provider, sku, productId, customer, requestedCurrency } = c;
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

  if (productErr) {
    return attempt.refuse(500, { error: `product lookup failed: ${productErr.message}` },
      { stage: "server", code: "product_lookup_failed", message: productErr.message });
  }
  if (!product) {
    return attempt.refuse(404, { error: "product_not_found" },
      { stage: "server", code: "product_not_found", message: `no active product ${productId ?? sku}` });
  }
  // A one-time product on Stripe gets a `payment` session: the web SDK sends every Stripe buy from a page
  // through here so the buyer returns to the site (a payment link strands them on Stripe's page), and the
  // 409 this used to return broke every web lifetime purchase (Status Saver pro-lifetime, 2026-11-23).
  // Razorpay one-time products keep their payment link — this lane creates Razorpay SUBSCRIPTIONS only.
  if (product.type !== "subscription" && provider !== "stripe") {
    return attempt.refuse(
      409,
      { error: "product is not a subscription — use the payment link from /config for one-time products" },
      { stage: "server", code: "not_a_subscription", message: `product ${product.sku} is ${product.type}` },
    );
  }

  // A win-back offer (the exit survey's discount). Refused — not silently dropped — when it is not this
  // buyer's or no longer live: the buyer clicked "claim 50% off", so charging full price without saying so
  // would be worse than an error the SDK turns into "this offer has ended" before a normal checkout.
  let winback: { offer: OfferRow; coupon: OfferCoupon } | null = null;
  if (typeof body.offerId === "string" && body.offerId.length > 0) {
    winback = await usableOffer(supabase, tenantId, body.offerId, customer.email!, typeof body.deviceRef === "string" ? body.deviceRef : null);
    if (!winback) {
      return attempt.refuse(409, { error: "offer_not_usable" },
        { stage: "server", code: "offer_not_usable", message: "win-back offer expired, redeemed or not this buyer's" });
    }
  }

  if (provider === "stripe") {
    return await stripeCheckout(supabase, req, body, tenantId, mode, product, customer, requestedCurrency, winback, attempt);
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
  if ("error" in resolved) {
    return attempt.refuse(409, { error: resolved.error }, { stage: "server", code: "no_plan_for_currency", message: resolved.error });
  }

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
    const error = `razorpay ${mode} credentials not configured for this tenant`;
    return attempt.refuse(409, { error }, { stage: "server", code: "credentials_missing", message: error });
  }

  const payload = razorpaySubscriptionPayload({
    planId: resolved.planId,
    interval: String(product.interval ?? "month"),
    email: customer.email!,
    phone: customer.phone,
    name: customer.name,
    tenantId,
    productId: product.id,
    sku: product.sku,
    mode,
    trialDays: effectiveTrial(product).days, // the rule /config advertises (_shared/trial.ts)
    nowSeconds: Math.floor(Date.now() / 1000),
    attemptId: attempt.attemptId,
    winback: winback?.coupon.razorpay_offer_id
      ? { razorpayOfferId: winback.coupon.razorpay_offer_id, offerId: winback.offer.id }
      : null,
  });

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
    return attempt.refuse(502, { error: `razorpay: ${detail}`, provider: "razorpay" },
      { stage: "provider", code: rzpJson?.error?.code ?? rzpRes.status, message: detail });
  }
  if (!rzpJson?.id || !rzpJson?.short_url) {
    return attempt.refuse(502, { error: "razorpay returned a subscription with no short_url" },
      { stage: "provider", code: "no_short_url", message: "razorpay returned a subscription with no short_url" });
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
        attempt_id: attempt.attemptId,
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

  await attempt.opened(rzpJson.id, rzpJson.id);
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
  attempt: CheckoutAttemptCtx,
): Promise<Response> {
  // Stripe ids are ACCOUNT-scoped per mode (migration 147). A live column not yet verified by a live
  // sync may still hold test ids, which would fail at Stripe with a confusing "No such price".
  if (mode === "live" && product.live_stripe_ids_verified === false) {
    const error = "live Stripe prices are not verified for this product — run a live Stripe sync";
    return attempt.refuse(409, { error }, { stage: "server", code: "live_prices_unverified", message: error });
  }
  const priceMap = (mode === "test" ? product.stripe_price_id_by_currency_test : product.stripe_price_id_by_currency) as
    | Record<string, string>
    | null;
  const price = pickByCurrency(priceMap, requestedCurrency, `${mode} Stripe price`);
  if ("error" in price) {
    return attempt.refuse(409, { error: price.error }, { stage: "server", code: "no_price_for_currency", message: price.error });
  }

  const back = returnUrls(typeof body.return_url === "string" ? body.return_url : null, req.headers.get("origin"));
  if ("error" in back) {
    return attempt.refuse(400, { error: back.error }, { stage: "server", code: "bad_return_url", message: back.error });
  }

  const { data: keys, error: keyErr } = await supabase
    .rpc("tenant_psp_credential_resolve", { p_tenant_id: tenantId, p_provider: "stripe", p_mode: mode })
    .single();
  const secret = (keys as { secret_key?: string } | null)?.secret_key;
  if (keyErr || !secret) {
    const error = `stripe ${mode} credentials not configured for this tenant`;
    return attempt.refuse(409, { error }, { stage: "server", code: "credentials_missing", message: error });
  }

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
      oneTime: product.type !== "subscription",
      success: back.success,
      cancel: back.cancel,
      discount: winback
        ? { promotionCodeId: winback.coupon.stripe_promotion_code_id, couponId: winback.coupon.stripe_coupon_id }
        : null,
      winbackOfferId: winback?.offer.id ?? null,
      attemptId: attempt.attemptId,
    }),
  });
  const session = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = session?.error?.message ?? `stripe ${res.status}`;
    return attempt.refuse(502, { error: `stripe: ${detail}`, provider: "stripe" },
      { stage: "provider", code: session?.error?.code ?? res.status, message: detail });
  }
  if (!session?.id || !session?.url) {
    return attempt.refuse(502, { error: "stripe returned a session with no url" },
      { stage: "provider", code: "no_session_url", message: "stripe returned a session with no url" });
  }

  await supabase
    .rpc("audit_log_emit", {
      p_tenant_id: tenantId,
      p_actor_user_id: null,
      p_actor_type: "sdk",
      p_action: "checkout.initiated",
      p_resource: `tenant_products:id=${product.id}`,
      p_after: {
        provider: "stripe",
        session_id: session.id,
        price_id: price.id,
        currency: price.currency,
        mode,
        attempt_id: attempt.attemptId,
      },
    })
    .then(
      () => {},
      () => {},
    );

  await attempt.opened(session.id, null);
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
