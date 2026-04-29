import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handleSubscriptionEvent } from "../_shared/subscription-handler.ts";

/**
 * Paystack Webhook Handler.
 *
 * Paystack signs webhooks with HMAC-SHA512 in `x-paystack-signature` header.
 *
 * Events handled:
 *   - subscription.create → active
 *   - subscription.not_renew → canceled (cancel at period end)
 *   - subscription.disable → canceled
 *   - charge.success (with plan) → active (renewal)
 *   - invoice.payment_failed → past_due
 */

const secretKey = Deno.env.get("PAYSTACK_SECRET_KEY") || "";

serve(async (req) => {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const tenantId: string | null = pathParts.length > 3 ? pathParts[3] : null;

  const body = await req.text();

  // Verify HMAC-SHA512 signature
  if (secretKey) {
    const signature = req.headers.get("x-paystack-signature") || "";
    const key = new TextEncoder().encode(secretKey);
    const data = new TextEncoder().encode(body);
    const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", cryptoKey, data);
    const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
    if (expected !== signature) {
      console.error("Paystack signature mismatch");
      return new Response("Invalid signature", { status: 401 });
    }
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const eventType = event.event;
  const eventData = event.data;
  const mode: "test" | "live" = secretKey.startsWith("sk_test_") ? "test" : "live";

  console.log(`Paystack event: ${eventType} | tenant=${tenantId || "self-hosted"}`);

  try {
    switch (eventType) {
      case "subscription.create": {
        await handleSubscriptionEvent({
          email: eventData.customer?.email || null,
          provider: "paystack",
          customerId: eventData.customer?.customer_code || null,
          subscriptionId: eventData.subscription_code || eventData.id?.toString(),
          plan: eventData.plan?.plan_code || "unknown",
          status: "active",
          mode,
          periodStart: eventData.createdAt ? new Date(eventData.createdAt) : null,
          periodEnd: eventData.next_payment_date ? new Date(eventData.next_payment_date) : null,
          cancelAtPeriodEnd: false,
          tenantId,
          eventType,
        });
        break;
      }
      case "subscription.not_renew": {
        await handleSubscriptionEvent({
          email: null,
          provider: "paystack",
          customerId: null,
          subscriptionId: eventData.subscription_code || eventData.id?.toString(),
          plan: null,
          status: "active",
          mode,
          periodStart: null,
          periodEnd: eventData.cancelledAt ? new Date(eventData.cancelledAt) : null,
          cancelAtPeriodEnd: true,
          tenantId,
          eventType,
        });
        break;
      }
      case "subscription.disable": {
        await handleSubscriptionEvent({
          email: null,
          provider: "paystack",
          customerId: null,
          subscriptionId: eventData.subscription_code || eventData.id?.toString(),
          plan: null,
          status: "canceled",
          mode,
          periodStart: null,
          periodEnd: null,
          cancelAtPeriodEnd: false,
          tenantId,
          eventType,
        });
        break;
      }
      case "charge.success": {
        if (eventData.plan && eventData.plan.plan_code) {
          await handleSubscriptionEvent({
            email: eventData.customer?.email || null,
            provider: "paystack",
            customerId: eventData.customer?.customer_code || null,
            subscriptionId: eventData.plan.plan_code,
            plan: eventData.plan.plan_code,
            status: "active",
            mode,
            periodStart: new Date(),
            periodEnd: null,
            cancelAtPeriodEnd: false,
            tenantId,
            eventType,
          });
        }
        break;
      }
      case "invoice.payment_failed": {
        await handleSubscriptionEvent({
          email: null,
          provider: "paystack",
          customerId: null,
          subscriptionId: eventData.subscription?.subscription_code || "unknown",
          plan: null,
          status: "past_due",
          mode,
          periodStart: null,
          periodEnd: null,
          cancelAtPeriodEnd: false,
          tenantId,
          eventType,
        });
        break;
      }
    }
  } catch (err: any) {
    console.error("Paystack webhook error:", err);
    return new Response(`Error: ${err.message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
