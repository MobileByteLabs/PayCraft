import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.0.0?target=deno";
import { handleSubscriptionEvent } from "../_shared/subscription-handler.ts";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, {
  apiVersion: "2023-10-16",
  httpClient: Stripe.createFetchHttpClient(),
});

const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;

serve(async (req) => {
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature", { status: 400 });
  }

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  console.log(`Received event: ${event.type}`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        let email = session.customer_email
          || (session as any).customer_details?.email;
        if (!email && session.customer) {
          const customer = await stripe.customers.retrieve(session.customer as string);
          email = (customer as any).email;
        }

        if (session.mode === "subscription" && email) {
          const sub = await stripe.subscriptions.retrieve(session.subscription as string);
          await handleSubscriptionEvent({
            email,
            provider: "stripe",
            customerId: session.customer as string,
            subscriptionId: session.subscription as string,
            plan: sub.items.data[0]?.price?.id || "unknown",
            status: "active",
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
