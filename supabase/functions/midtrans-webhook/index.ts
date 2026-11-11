import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { withWebhookRateLimit } from "../_shared/webhook-rate-limit.ts";
import { tenantIdFromPath } from "../_shared/webhook-path.ts";
import { handleSubscriptionEvent } from "../_shared/subscription-handler.ts";

/**
 * Midtrans Webhook (Notification) Handler.
 *
 * Midtrans sends payment notifications to a configured URL.
 * Verification via SHA-512 signature: SHA512(order_id + status_code + gross_amount + server_key).
 *
 * Events handled:
 *   - transaction_status: capture/settlement → active
 *   - transaction_status: cancel/deny/expire → canceled
 *   - transaction_status: pending → pending
 */

const serverKey = Deno.env.get("MIDTRANS_SERVER_KEY") || "";

serve(withWebhookRateLimit({ bucket: "webhook:midtrans" }, async (req) => {
  const tenantId: string | null = tenantIdFromPath(req.url, "midtrans-webhook");

  const body = await req.text();
  let notification: any;
  try {
    notification = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Verify Midtrans signature — FAIL CLOSED: unset secret → 500, missing signature → 401.
  if (!serverKey) return new Response("Webhook secret not configured", { status: 500 });
  if (!notification.signature_key) return new Response("Missing signature", { status: 401 });
  {
    const payload = `${notification.order_id}${notification.status_code}${notification.gross_amount}${serverKey}`;
    const data = new TextEncoder().encode(payload);
    const hash = await crypto.subtle.digest("SHA-512", data);
    const expected = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("");
    if (expected !== notification.signature_key) {
      console.error("Midtrans signature mismatch");
      return new Response("Invalid signature", { status: 401 });
    }
  }

  const txStatus = notification.transaction_status;
  const mode: "test" | "live" = Deno.env.get("MIDTRANS_SANDBOX") === "true" ? "test" : "live";

  console.log(`Midtrans event: ${txStatus} | order=${notification.order_id} | tenant=${tenantId || "self-hosted"}`);

  try {
    const statusMap: Record<string, string> = {
      capture: "active",
      settlement: "active",
      pending: "active", // treat pending payment as active (optimistic)
      cancel: "canceled",
      deny: "canceled",
      expire: "canceled",
      refund: "canceled",
    };

    const status = statusMap[txStatus];
    if (status) {
      // Midtrans order_id often encodes plan: e.g., "pro_monthly_user123"
      const orderId = notification.order_id || "";
      const planGuess = orderId.split("_").slice(0, -1).join("_") || "unknown";

      await handleSubscriptionEvent({
        email: notification.customer_details?.email || null,
        provider: "midtrans",
        customerId: notification.customer_details?.customer_id || null,
        subscriptionId: orderId,
        plan: planGuess,
        status,
        mode,
        periodStart: notification.transaction_time ? new Date(notification.transaction_time) : null,
        periodEnd: null,
        cancelAtPeriodEnd: false,
        tenantId,
        eventType: `transaction.${txStatus}`,
      });
    }
  } catch (err: any) {
    console.error("Midtrans webhook error:", err);
    return new Response(`Error: ${err.message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}));
