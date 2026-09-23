import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { withWebhookRateLimit } from "../_shared/webhook-rate-limit.ts";
import Stripe from "https://esm.sh/stripe@14.0.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Cloud Billing Webhook — handles PayCraft Cloud's own Stripe subscription events.
 * When a tenant upgrades/downgrades/cancels their PayCraft Cloud plan,
 * this webhook updates their tenants row.
 */

/**
 * CREDENTIALS — name mismatch fixed 2026-09-23.
 *
 * This read `PAYCRAFT_CLOUD_STRIPE_SECRET_KEY` / `PAYCRAFT_CLOUD_BILLING_WEBHOOK_SECRET`. Neither
 * has ever been set on the project. The equivalents ARE set, under
 * `PAYCRAFT_STRIPE_{LIVE,TEST}_SECRET_KEY` / `PAYCRAFT_STRIPE_{LIVE,TEST}_WEBHOOK_SECRET`, because
 * two command runtimes disagree about the names: `paycraft-adopt-cloud.md` provisions the CLOUD_*
 * spelling this file used, while `paycraft-adopt-keys.md` + `paycraft-adopt-verify.md` provision
 * the STRIPE_{LIVE,TEST}_* spelling production actually followed.
 *
 * Consequence, measured against production: every event returned `500 Stripe not configured`.
 * Stripe treats 5xx as retryable, retries on its schedule, then gives up — so a tenant's plan
 * change was SILENTLY LOST. Someone downgrades and keeps enterprise limits; someone upgrades and
 * never receives them. A 500 reads like a transient blip, so nothing surfaced it.
 *
 * The STRIPE_{LIVE,TEST}_* spelling wins because it is what production has, what two of the three
 * runtimes provision, and — unlike the CLOUD_* pair — it carries a live/test split, which this
 * webhook needs in order to verify a test event at all. The legacy names are still read as a last
 * resort so an installation provisioned from paycraft-adopt-cloud keeps working.
 */
const env = (...names: string[]): string => {
  for (const n of names) {
    const v = Deno.env.get(n);
    if (v) return v;
  }
  return "";
};

const liveKey = env("PAYCRAFT_STRIPE_LIVE_SECRET_KEY", "PAYCRAFT_CLOUD_STRIPE_SECRET_KEY");
const testKey = env("PAYCRAFT_STRIPE_TEST_SECRET_KEY");
const liveWebhookSecret = env(
  "PAYCRAFT_STRIPE_LIVE_WEBHOOK_SECRET",
  "PAYCRAFT_CLOUD_BILLING_WEBHOOK_SECRET",
);
const testWebhookSecret = env("PAYCRAFT_STRIPE_TEST_WEBHOOK_SECRET");

const stripeKey = liveKey || testKey;
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

serve(withWebhookRateLimit({ bucket: "webhook:cloud-billing" }, async (req) => {
  if (!stripe) {
    // Name the variable. "Stripe not configured" cost a day precisely because it did not say WHICH
    // key was missing, so a pure name mismatch was indistinguishable from an unprovisioned install.
    console.error(
      "cloud-billing: no Stripe key. Set PAYCRAFT_STRIPE_LIVE_SECRET_KEY (or _TEST_) on the project.",
    );
    return new Response(
      "Stripe not configured — set PAYCRAFT_STRIPE_LIVE_SECRET_KEY",
      { status: 500 },
    );
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing stripe-signature", { status: 400 });
  }

  const body = await req.text();

  // Try every configured secret. Stripe signs a TEST event with the TEST endpoint's secret, so a
  // single-secret verify rejects half the traffic the moment test mode is exercised — and rejects
  // it as "bad signature", which reads like an attack rather than a missing config.
  //
  // Order matters only for cost: live first, because live is the overwhelming majority.
  const candidates = [
    { mode: "live", secret: liveWebhookSecret },
    { mode: "test", secret: testWebhookSecret },
  ].filter((c) => c.secret);

  if (candidates.length === 0) {
    console.error(
      "cloud-billing: no webhook secret. Set PAYCRAFT_STRIPE_LIVE_WEBHOOK_SECRET (or _TEST_).",
    );
    return new Response(
      "Webhook secret not configured — set PAYCRAFT_STRIPE_LIVE_WEBHOOK_SECRET",
      { status: 500 },
    );
  }

  let event: Stripe.Event | null = null;
  let lastErr = "";
  for (const c of candidates) {
    try {
      event = await stripe.webhooks.constructEventAsync(body, signature, c.secret);
      break;
    } catch (err) {
      lastErr = err instanceof Error ? err.message : String(err);
    }
  }
  if (!event) {
    // Genuinely unverifiable against ANY configured secret — a forged or misrouted delivery.
    console.error("Signature verification failed against all configured secrets:", lastErr);
    return new Response(`Webhook Error: ${lastErr}`, { status: 400 });
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
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Error processing cloud billing event:", err);
    return new Response(`Processing Error: ${msg}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}));
