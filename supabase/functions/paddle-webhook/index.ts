import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handleSubscriptionEvent } from "../_shared/subscription-handler.ts";
import { createHmac } from "https://deno.land/std@0.177.0/crypto/mod.ts";

/**
 * Paddle Webhook Handler.
 *
 * Paddle Billing (v2) sends events as JSON with an `h1` HMAC-SHA256 signature
 * in the `Paddle-Signature` header.
 *
 * Events handled:
 *   - subscription.activated → active
 *   - subscription.updated → active/past_due
 *   - subscription.canceled → canceled
 *   - subscription.paused → paused
 */

const webhookSecret = Deno.env.get("PADDLE_WEBHOOK_SECRET") || "";

serve(async (req) => {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const tenantId: string | null = pathParts.length > 3 ? pathParts[3] : null;

  const body = await req.text();

  // Verify Paddle signature
  const paddleSig = req.headers.get("paddle-signature") || "";
  if (webhookSecret && paddleSig) {
    const parts = Object.fromEntries(
      paddleSig.split(";").map((p: string) => p.split("=") as [string, string])
    );
    const ts = parts["ts"];
    const h1 = parts["h1"];
    if (ts && h1) {
      const payload = `${ts}:${body}`;
      const key = new TextEncoder().encode(webhookSecret);
      const data = new TextEncoder().encode(payload);
      const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
      const sig = await crypto.subtle.sign("HMAC", cryptoKey, data);
      const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
      if (expected !== h1) {
        console.error("Paddle signature mismatch");
        return new Response("Invalid signature", { status: 401 });
      }
    }
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const eventType = event.event_type;
  const data = event.data;
  console.log(`Paddle event: ${eventType} | tenant=${tenantId || "self-hosted"}`);

  const isLive = event.environment !== "sandbox";
  const mode: "test" | "live" = isLive ? "live" : "test";

  try {
    switch (eventType) {
      case "subscription.activated":
      case "subscription.updated": {
        const status = data.status === "past_due" ? "past_due"
          : data.status === "paused" ? "canceled"
          : "active";
        await handleSubscriptionEvent({
          email: data.customer_email || null,
          provider: "paddle",
          customerId: data.customer_id || null,
          subscriptionId: data.id,
          plan: data.items?.[0]?.price?.id || data.items?.[0]?.product_id || "unknown",
          status,
          mode,
          periodStart: data.current_billing_period?.starts_at ? new Date(data.current_billing_period.starts_at) : null,
          periodEnd: data.current_billing_period?.ends_at ? new Date(data.current_billing_period.ends_at) : null,
          cancelAtPeriodEnd: data.scheduled_change?.action === "cancel",
          tenantId,
          eventType,
        });
        break;
      }
      case "subscription.canceled": {
        await handleSubscriptionEvent({
          email: null,
          provider: "paddle",
          customerId: null,
          subscriptionId: data.id,
          plan: null,
          status: "canceled",
          mode,
          periodStart: null,
          periodEnd: data.current_billing_period?.ends_at ? new Date(data.current_billing_period.ends_at) : null,
          cancelAtPeriodEnd: false,
          tenantId,
          eventType,
        });
        break;
      }
    }
  } catch (err: any) {
    console.error("Paddle webhook error:", err);
    return new Response(`Error: ${err.message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
