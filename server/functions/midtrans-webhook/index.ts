import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
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

serve(async (req) => {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const tenantId: string | null = pathParts.length > 3 ? pathParts[3] : null;

  const body = await req.text();
  let notification: any;
  try {
    notification = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Verify Midtrans signature
  if (serverKey && notification.signature_key) {
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
});
