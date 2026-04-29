import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handleSubscriptionEvent } from "../_shared/subscription-handler.ts";

/**
 * LemonSqueezy Webhook Handler.
 *
 * LemonSqueezy signs webhooks with HMAC-SHA256 in `X-Signature` header.
 *
 * Events handled:
 *   - subscription_created → active
 *   - subscription_updated → active/past_due/canceled
 *   - subscription_cancelled → canceled
 *   - subscription_expired → canceled
 */

const signingSecret = Deno.env.get("LEMONSQUEEZY_WEBHOOK_SECRET") || "";

serve(async (req) => {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const tenantId: string | null = pathParts.length > 3 ? pathParts[3] : null;

  const body = await req.text();

  // Verify HMAC signature
  if (signingSecret) {
    const signature = req.headers.get("x-signature") || "";
    const key = new TextEncoder().encode(signingSecret);
    const data = new TextEncoder().encode(body);
    const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", cryptoKey, data);
    const expected = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
    if (expected !== signature) {
      console.error("LemonSqueezy signature mismatch");
      return new Response("Invalid signature", { status: 401 });
    }
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const eventName = event.meta?.event_name;
  const attrs = event.data?.attributes;
  const mode: "test" | "live" = attrs?.test_mode ? "test" : "live";

  console.log(`LemonSqueezy event: ${eventName} | tenant=${tenantId || "self-hosted"}`);

  try {
    const statusMap: Record<string, string> = {
      subscription_created: "active",
      subscription_updated: attrs?.status === "past_due" ? "past_due" : attrs?.status === "cancelled" ? "canceled" : "active",
      subscription_cancelled: "canceled",
      subscription_expired: "canceled",
    };

    const status = statusMap[eventName];
    if (status && attrs) {
      await handleSubscriptionEvent({
        email: attrs.user_email || null,
        provider: "lemonsqueezy",
        customerId: attrs.customer_id?.toString() || null,
        subscriptionId: event.data.id?.toString() || attrs.order_id?.toString(),
        plan: attrs.variant_id?.toString() || attrs.product_id?.toString() || "unknown",
        status,
        mode,
        periodStart: attrs.renews_at ? new Date(attrs.renews_at) : null,
        periodEnd: attrs.ends_at ? new Date(attrs.ends_at) : null,
        cancelAtPeriodEnd: attrs.cancelled === true,
        tenantId,
        eventType: eventName,
      });
    }
  } catch (err: any) {
    console.error("LemonSqueezy webhook error:", err);
    return new Response(`Error: ${err.message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
