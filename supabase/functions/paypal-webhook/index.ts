import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handleSubscriptionEvent } from "../_shared/subscription-handler.ts";

/**
 * PayPal Webhook Handler.
 *
 * PayPal sends subscription events via IPN/Webhooks.
 * Signature verification uses PayPal's verify-webhook-signature API.
 *
 * Events handled:
 *   - BILLING.SUBSCRIPTION.ACTIVATED → active
 *   - BILLING.SUBSCRIPTION.UPDATED → active
 *   - BILLING.SUBSCRIPTION.CANCELLED → canceled
 *   - BILLING.SUBSCRIPTION.SUSPENDED → past_due
 *   - BILLING.SUBSCRIPTION.EXPIRED → canceled
 */

const webhookId = Deno.env.get("PAYPAL_WEBHOOK_ID") || "";
const clientId = Deno.env.get("PAYPAL_CLIENT_ID") || "";
const clientSecret = Deno.env.get("PAYPAL_CLIENT_SECRET") || "";
const isSandbox = Deno.env.get("PAYPAL_SANDBOX") === "true";
const baseUrl = isSandbox ? "https://api-m.sandbox.paypal.com" : "https://api-m.paypal.com";

serve(async (req) => {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const tenantId: string | null = pathParts.length > 3 ? pathParts[3] : null;

  const body = await req.text();
  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Verify webhook signature via PayPal API
  if (webhookId && clientId && clientSecret) {
    try {
      const authRes = await fetch(`${baseUrl}/v1/oauth2/token`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: "grant_type=client_credentials",
      });
      const { access_token } = await authRes.json();

      const verifyRes = await fetch(`${baseUrl}/v1/notifications/verify-webhook-signature`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          auth_algo: req.headers.get("paypal-auth-algo"),
          cert_url: req.headers.get("paypal-cert-url"),
          transmission_id: req.headers.get("paypal-transmission-id"),
          transmission_sig: req.headers.get("paypal-transmission-sig"),
          transmission_time: req.headers.get("paypal-transmission-time"),
          webhook_id: webhookId,
          webhook_event: event,
        }),
      });
      const { verification_status } = await verifyRes.json();
      if (verification_status !== "SUCCESS") {
        console.error("PayPal signature verification failed");
        return new Response("Invalid signature", { status: 401 });
      }
    } catch (err: any) {
      console.error("PayPal verification error:", err.message);
    }
  }

  const eventType = event.event_type;
  const resource = event.resource;
  const mode: "test" | "live" = isSandbox ? "test" : "live";

  console.log(`PayPal event: ${eventType} | tenant=${tenantId || "self-hosted"}`);

  try {
    const statusMap: Record<string, string> = {
      "BILLING.SUBSCRIPTION.ACTIVATED": "active",
      "BILLING.SUBSCRIPTION.UPDATED": "active",
      "BILLING.SUBSCRIPTION.CANCELLED": "canceled",
      "BILLING.SUBSCRIPTION.SUSPENDED": "past_due",
      "BILLING.SUBSCRIPTION.EXPIRED": "canceled",
    };

    const status = statusMap[eventType];
    if (status && resource?.id) {
      await handleSubscriptionEvent({
        email: resource.subscriber?.email_address || null,
        provider: "paypal",
        customerId: resource.subscriber?.payer_id || null,
        subscriptionId: resource.id,
        plan: resource.plan_id || "unknown",
        status,
        mode,
        periodStart: resource.billing_info?.last_payment?.time ? new Date(resource.billing_info.last_payment.time) : null,
        periodEnd: resource.billing_info?.next_billing_time ? new Date(resource.billing_info.next_billing_time) : null,
        cancelAtPeriodEnd: eventType === "BILLING.SUBSCRIPTION.CANCELLED",
        tenantId,
        eventType,
      });
    }
  } catch (err: any) {
    console.error("PayPal webhook error:", err);
    return new Response(`Error: ${err.message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
