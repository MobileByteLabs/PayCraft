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

  const body = await req.text();

  // Verify signature — try test secret first, then live secret.
  // Whichever succeeds determines the mode; event.livemode is the final authority.
  let event: Stripe.Event | null = null;
  let stripeMode: "test" | "live" = "test";
  let stripeClient: Stripe | null = stripeTest || stripeLive;

  if (testWebhookSecret) {
    try {
      const client = stripeTest || stripeLive!;
      event = await client.webhooks.constructEventAsync(body, signature, testWebhookSecret);
    } catch { /* try live */ }
  }

  if (!event && liveWebhookSecret && liveWebhookSecret !== testWebhookSecret) {
    try {
      const client = stripeLive || stripeTest!;
      event = await client.webhooks.constructEventAsync(body, signature, liveWebhookSecret);
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return new Response(`Webhook Error: ${err.message}`, { status: 400 });
    }
  }

  if (!event) {
    return new Response("No valid webhook secret matched the signature", { status: 400 });
  }

  // event.livemode is the source of truth — overrides which secret verified first
  stripeMode = event.livemode ? "live" : "test";
  stripeClient = stripeMode === "live"
    ? (stripeLive || stripeTest)
    : (stripeTest || stripeLive);

  console.log(`Received event: ${event.type} | mode=${stripeMode}`);

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
