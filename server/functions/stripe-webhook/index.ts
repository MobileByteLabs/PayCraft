import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.0.0?target=deno";
import { handleSubscriptionEvent } from "../_shared/subscription-handler.ts";

// Test + live keys deployed separately — mode derived from event.livemode, not key prefix.
// Legacy STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET retained as fallback for existing deploys.
const testSecretKey = Deno.env.get("STRIPE_TEST_SECRET_KEY") || Deno.env.get("STRIPE_SECRET_KEY") || "";
const liveSecretKey = Deno.env.get("STRIPE_LIVE_SECRET_KEY") || "";
const testWebhookSecret = Deno.env.get("STRIPE_TEST_WEBHOOK_SECRET") || Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";
const liveWebhookSecret = Deno.env.get("STRIPE_LIVE_WEBHOOK_SECRET") || Deno.env.get("STRIPE_WEBHOOK_SECRET") || "";

// Lazy Stripe clients — only instantiated if the key is present
const stripeTest = testSecretKey
  ? new Stripe(testSecretKey, { apiVersion: "2023-10-16", httpClient: Stripe.createFetchHttpClient() })
  : null;
const stripeLive = liveSecretKey
  ? new Stripe(liveSecretKey, { apiVersion: "2023-10-16", httpClient: Stripe.createFetchHttpClient() })
  : null;

serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature", { status: 400 });
  }

  // Extract optional tenant_id from URL path:
  // /stripe-webhook/{tenant_id} → multi-tenant
  // /stripe-webhook             → single-tenant (self-hosted)
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  // Path: ["functions", "v1", "stripe-webhook", maybe-tenant-id]
  const tenantId: string | null = pathParts.length > 3 ? pathParts[3] : null;

  const body = await req.text();

  // Determine mode from the raw payload BEFORE signature verification.
  // This prevents a compromised test secret from forging live events.
  let parsedBody: { livemode?: boolean };
  try {
    parsedBody = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const isLive = parsedBody.livemode === true;
  const webhookSecret = isLive ? liveWebhookSecret : testWebhookSecret;
  const stripeClient = isLive ? (stripeLive || stripeTest) : (stripeTest || stripeLive);

  if (!webhookSecret) {
    console.error(`No webhook secret configured for ${isLive ? "live" : "test"} mode`);
    return new Response("Webhook secret not configured for this mode", { status: 500 });
  }

  if (!stripeClient) {
    console.error(`No Stripe client available for ${isLive ? "live" : "test"} mode`);
    return new Response("Stripe client not configured for this mode", { status: 500 });
  }

  // Verify signature with the CORRECT key — no fallback to other mode
  let event: Stripe.Event;
  try {
    event = await stripeClient.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error(`Webhook signature verification failed (${isLive ? "live" : "test"}):`, err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  const stripeMode: "test" | "live" = isLive ? "live" : "test";

  console.log(`Received event: ${event.type} | mode=${stripeMode} | tenant=${tenantId || "self-hosted"}`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        let email = session.customer_email
          || (session as any).customer_details?.email;
        if (!email && session.customer) {
          const customer = await stripeClient!.customers.retrieve(session.customer as string);
          email = (customer as any).email;
        }

        if (session.mode === "subscription" && email) {
          const sub = await stripeClient!.subscriptions.retrieve(session.subscription as string);
          await handleSubscriptionEvent({
            email,
            provider: "stripe",
            customerId: session.customer as string,
            subscriptionId: session.subscription as string,
            plan: session.metadata?.plan_id || sub.items.data[0]?.price?.metadata?.plan_id || sub.items.data[0]?.price?.id || "unknown",
            status: "active",
            mode: stripeMode,
            periodStart: new Date(sub.current_period_start * 1000),
            periodEnd: new Date(sub.current_period_end * 1000),
            cancelAtPeriodEnd: sub.cancel_at_period_end,
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
    }
  } catch (err) {
    console.error("Error processing webhook:", err);
    return new Response(`Processing Error: ${err.message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
