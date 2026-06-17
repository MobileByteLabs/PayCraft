import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { withWebhookRateLimit } from "../_shared/webhook-rate-limit.ts";
import Stripe from "https://esm.sh/stripe@14.0.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";
import { handleSubscriptionEvent } from "../_shared/subscription-handler.ts";

/**
 * Multi-tenant Stripe webhook receiver.
 *
 * URL shapes:
 *   /functions/v1/stripe-webhook/{tenant_id}   — multi-tenant (preferred)
 *   /functions/v1/stripe-webhook               — single-tenant (legacy)
 *
 * Credential resolution order:
 *   1. If {tenant_id} in path → load test/live webhook secrets + secret keys
 *      from `tenant_providers` (via tenant_providers_decrypt_for_webhook RPC,
 *      service-role only). This is the path Manual-API-keys + per-tenant
 *      Stripe CLI tunnels use, and is why the older env-var-only handler
 *      returned 500 for every event.
 *   2. Otherwise fall back to env vars (legacy single-tenant self-hosters).
 *
 * Behavior for unhandled event types (product.created, plan.created,
 * price.created, payment_link.created, …): explicit 200 ack with `ignored:
 * true` payload — Stripe stops retrying immediately, so the CLI no longer
 * floods the terminal with 500s for events we don't care about.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "http://kong:8000";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Legacy env fallbacks (single-tenant self-hosters).
const envTestSecretKey =
  Deno.env.get("STRIPE_TEST_SECRET_KEY") || Deno.env.get("STRIPE_SECRET_KEY") || "";
const envLiveSecretKey = Deno.env.get("STRIPE_LIVE_SECRET_KEY") || "";
const envTestWebhookSecret =
  Deno.env.get("STRIPE_TEST_WEBHOOK_SECRET") || Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
const envLiveWebhookSecret =
  Deno.env.get("STRIPE_LIVE_WEBHOOK_SECRET") || Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";

interface TenantCreds {
  secretKey: string;
  webhookSecret: string;
}

/**
 * Pull per-tenant Stripe credentials from the database. Returns null when
 * the tenant has no row OR the requested mode isn't populated — caller
 * decides whether to fall back to env vars or refuse the event.
 */
async function loadTenantCreds(
  tenantId: string,
  mode: "test" | "live",
): Promise<TenantCreds | null> {
  if (!SERVICE_ROLE) return null;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin
    .rpc("tenant_providers_decrypt_for_webhook", {
      p_tenant_id: tenantId,
      p_provider: "stripe",
      p_mode: mode,
    })
    .maybeSingle();
  if (error) {
    console.error(
      `[stripe-webhook] tenant_providers_decrypt_for_webhook failed (tenant=${tenantId}, mode=${mode}): ${error.message}`,
    );
    return null;
  }
  if (!data?.secret_key || !data?.webhook_secret) return null;
  return { secretKey: data.secret_key, webhookSecret: data.webhook_secret };
}

serve(withWebhookRateLimit({ bucket: "webhook:stripe" }, async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature", { status: 400 });
  }

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  // Path: ["functions", "v1", "stripe-webhook", maybe-tenant-id]
  const tenantId: string | null = pathParts.length > 3 ? pathParts[3] : null;

  const body = await req.text();

  // Determine mode from the unverified payload first so we know which
  // credential pair to fetch. We never act on the parsed body before
  // signature verification — only use it to pick the right key.
  let parsedBody: { livemode?: boolean; type?: string };
  try {
    parsedBody = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }
  const isLive = parsedBody.livemode === true;
  const stripeMode: "test" | "live" = isLive ? "live" : "test";

  // Resolve credentials — tenant DB first, env fallback.
  let secretKey = "";
  let webhookSecret = "";
  if (tenantId) {
    const creds = await loadTenantCreds(tenantId, stripeMode);
    if (creds) {
      secretKey = creds.secretKey;
      webhookSecret = creds.webhookSecret;
    }
  }
  if (!secretKey || !webhookSecret) {
    secretKey = isLive ? envLiveSecretKey || envTestSecretKey : envTestSecretKey || envLiveSecretKey;
    webhookSecret = isLive ? envLiveWebhookSecret : envTestWebhookSecret;
  }

  if (!webhookSecret) {
    console.error(
      `[stripe-webhook] No ${stripeMode} webhook secret available (tenant=${tenantId ?? "self-hosted"}). Paste fresh whsec_ via dashboard → /providers/stripe → Update keys.`,
    );
    return new Response(
      `No ${stripeMode} webhook secret configured for tenant ${tenantId ?? "self-hosted"}`,
      { status: 500 },
    );
  }
  if (!secretKey) {
    console.error(
      `[stripe-webhook] No ${stripeMode} secret key available (tenant=${tenantId ?? "self-hosted"}).`,
    );
    return new Response(
      `No ${stripeMode} secret key configured for tenant ${tenantId ?? "self-hosted"}`,
      { status: 500 },
    );
  }

  const stripeClient = new Stripe(secretKey, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });

  let event: Stripe.Event;
  try {
    event = await stripeClient.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error(
      `[stripe-webhook] signature verification failed (mode=${stripeMode}, tenant=${tenantId ?? "self-hosted"}): ${(err as Error).message}`,
    );
    return new Response(`Webhook Error: ${(err as Error).message}`, { status: 400 });
  }

  console.log(
    `[stripe-webhook] event=${event.type} mode=${stripeMode} tenant=${tenantId ?? "self-hosted"}`,
  );

  // Service-role client for any RPCs that need to write outside RLS. We only
  // build it once verification succeeds so unverified payloads can't drive
  // arbitrary RPC calls.
  const supabase = SERVICE_ROLE
    ? createClient(SUPABASE_URL, SERVICE_ROLE, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        let email =
          session.customer_email || (session as any).customer_details?.email;
        if (!email && session.customer) {
          const customer = await stripeClient.customers.retrieve(
            session.customer as string,
          );
          email = (customer as any).email;
        }

        if (session.mode === "subscription" && email) {
          const sub = await stripeClient.subscriptions.retrieve(
            session.subscription as string,
          );
          if (supabase) {
            await maybeIncrementCouponRedemption(supabase, sub);
          }
          // Stripe `status === "trialing"` when the subscription is in its trial window.
          // `trial_start` / `trial_end` are unix seconds on the Subscription object.
          const status = sub.status === "trialing" ? "trialing" : "active";
          await handleSubscriptionEvent({
            email,
            provider: "stripe",
            customerId: session.customer as string,
            subscriptionId: session.subscription as string,
            plan:
              session.metadata?.plan_id ||
              sub.items.data[0]?.price?.metadata?.plan_id ||
              sub.items.data[0]?.price?.id ||
              "unknown",
            status,
            mode: stripeMode,
            periodStart: new Date(sub.current_period_start * 1000),
            periodEnd: new Date(sub.current_period_end * 1000),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
            trialStart: sub.trial_start ? new Date(sub.trial_start * 1000) : null,
            trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
            tenantId,
            eventType: event.type,
          });
        }
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await handleSubscriptionEvent({
          email: null,
          provider: "stripe",
          customerId: null,
          subscriptionId: sub.id,
          plan: null,
          status: sub.status as any,
          mode: stripeMode,
          periodStart: new Date(sub.current_period_start * 1000),
          periodEnd: new Date(sub.current_period_end * 1000),
          cancelAtPeriodEnd: sub.cancel_at_period_end,
          trialStart: sub.trial_start ? new Date(sub.trial_start * 1000) : null,
          trialEnd: sub.trial_end ? new Date(sub.trial_end * 1000) : null,
          tenantId,
          eventType: event.type,
        });
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        if (invoice.subscription) {
          await handleSubscriptionEvent({
            email: null,
            provider: "stripe",
            customerId: null,
            subscriptionId: invoice.subscription as string,
            plan: null,
            status: "active",
            mode: stripeMode,
            periodStart: null,
            periodEnd: null,
            cancelAtPeriodEnd: false,
            tenantId,
            eventType: event.type,
          });
        }
        break;
      }

      case "charge.refunded": {
        // Phase 4 of paycraft-v2-production-readiness — full refund flow.
        // When a charge is fully refunded, locate the related subscription
        // (via the invoice → subscription chain) and mark it canceled.
        // Partial refunds keep the subscription active.
        const charge = event.data.object as Stripe.Charge;
        const isFullRefund =
          charge.refunded === true && charge.amount_refunded >= charge.amount;
        if (!isFullRefund) break;

        let subscriptionId: string | null = null;
        if (charge.invoice) {
          const invoice = await stripeClient.invoices.retrieve(
            charge.invoice as string,
          );
          subscriptionId = (invoice.subscription as string) || null;
        }
        if (!subscriptionId) break;

        await handleSubscriptionEvent({
          email: null,
          provider: "stripe",
          customerId: charge.customer as string | null,
          subscriptionId,
          plan: null,
          status: "canceled",
          mode: stripeMode,
          periodStart: null,
          periodEnd: null,
          cancelAtPeriodEnd: false,
          tenantId,
          eventType: event.type,
        });
        break;
      }

      default: {
        // Stripe forwards every account event (product.created, plan.created,
        // price.created, payment_link.created, etc) when the CLI tunnel runs
        // with no event-type filter. Ack them explicitly so Stripe stops
        // retrying — otherwise the CLI fills the terminal with 500s for
        // events we never intended to handle.
        return new Response(
          JSON.stringify({ received: true, ignored: true, event_type: event.type }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
    }
  } catch (err) {
    console.error(
      `[stripe-webhook] processing error (event=${event.type}):`,
      err,
    );
    return new Response(`Processing Error: ${(err as Error).message}`, {
      status: 500,
    });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}));

/**
 * Pull the coupon id off a Stripe Subscription (either the legacy `discount`
 * single-coupon field or the newer `discounts[]` array) and bump the matching
 * row in `tenant_coupons`. No-op when the subscription was checked out
 * without any coupon. Safe to call from any event handler — duplicate
 * increments are acceptable for this counter.
 */
async function maybeIncrementCouponRedemption(
  supabase: ReturnType<typeof createClient>,
  sub: Stripe.Subscription,
): Promise<void> {
  const legacyCouponId = (sub as any).discount?.coupon?.id as string | undefined;
  const arrayCouponId = ((sub as any).discounts as any[] | undefined)
    ?.map((d) => d?.coupon?.id)
    .find((id) => typeof id === "string") as string | undefined;
  const couponId = legacyCouponId ?? arrayCouponId;
  if (!couponId) return;
  try {
    await supabase.rpc("tenant_coupons_increment_redeemed", {
      p_stripe_coupon_id: couponId,
    });
  } catch (e: any) {
    console.warn("[stripe-webhook] increment_redeemed failed:", e?.message);
  }
}
