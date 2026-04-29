import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.0.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Cloud Billing Webhook — handles PayCraft Cloud's own Stripe subscription events.
 * When a tenant upgrades/downgrades/cancels their PayCraft Cloud plan,
 * this webhook updates their tenants row.
 */

const stripeKey = Deno.env.get("PAYCRAFT_CLOUD_STRIPE_SECRET_KEY") || "";
const webhookSecret = Deno.env.get("PAYCRAFT_CLOUD_BILLING_WEBHOOK_SECRET") || "";
const stripe = stripeKey
  ? new Stripe(stripeKey, { apiVersion: "2023-10-16", httpClient: Stripe.createFetchHttpClient() })
  : null;

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

// Plan mapping: Stripe Price ID → PayCraft plan + limit
const PLAN_MAP: Record<string, { plan: string; limit: number }> = {
  // Set these to your actual Stripe Price IDs
  "price_pro_monthly": { plan: "pro", limit: 10000 },
  "price_pro_annual": { plan: "pro", limit: 10000 },
  "price_enterprise_monthly": { plan: "enterprise", limit: 999999 },
  "price_enterprise_annual": { plan: "enterprise", limit: 999999 },
};

serve(async (req) => {
  if (!stripe) {
    return new Response("Stripe not configured", { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature", { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, webhookSecret);
  } catch (err) {
    console.error("Signature verification failed:", err.message);
    return new Response(`Webhook Error: ${err.message}`, { status: 400 });
  }

  console.log(`Cloud billing event: ${event.type}`);

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const tenantId = session.metadata?.tenant_id;
        if (!tenantId || !session.subscription) break;

        const sub = await stripe.subscriptions.retrieve(session.subscription as string);
        const priceId = sub.items.data[0]?.price?.id || "";
        const planInfo = PLAN_MAP[priceId] || { plan: "pro", limit: 10000 };

        await supabase.rpc("upgrade_tenant_plan", {
          p_tenant_id: tenantId,
          p_plan: planInfo.plan,
          p_subscriber_limit: planInfo.limit,
          p_stripe_customer_id: session.customer as string,
          p_stripe_sub_id: session.subscription as string,
          p_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        });

        console.log(`Tenant ${tenantId} upgraded to ${planInfo.plan}`);
        break;
      }

      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        // Find tenant by stripe_customer_id
        const { data: tenant } = await supabase
          .from("tenants")
          .select("id")
          .eq("stripe_customer_id", sub.customer as string)
          .single();

        if (!tenant) break;

        const priceId = sub.items.data[0]?.price?.id || "";
        const planInfo = PLAN_MAP[priceId] || { plan: "pro", limit: 10000 };

        await supabase.rpc("upgrade_tenant_plan", {
          p_tenant_id: tenant.id,
          p_plan: planInfo.plan,
          p_subscriber_limit: planInfo.limit,
          p_stripe_sub_id: sub.id,
          p_period_end: new Date(sub.current_period_end * 1000).toISOString(),
        });
        break;
      }

      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const { data: tenant } = await supabase
          .from("tenants")
          .select("id")
          .eq("stripe_customer_id", sub.customer as string)
          .single();

        if (!tenant) break;

        // Downgrade to free
        await supabase.rpc("upgrade_tenant_plan", {
          p_tenant_id: tenant.id,
          p_plan: "free",
          p_subscriber_limit: 100,
        });

        console.log(`Tenant ${tenant.id} downgraded to free`);
        break;
      }
    }
  } catch (err) {
    console.error("Error processing cloud billing event:", err);
    return new Response(`Processing Error: ${err.message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
