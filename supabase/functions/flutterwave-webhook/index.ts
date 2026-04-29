import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handleSubscriptionEvent } from "../_shared/subscription-handler.ts";

/**
 * Flutterwave Webhook Handler.
 *
 * Flutterwave sends a `verif-hash` header for signature verification.
 *
 * Events handled:
 *   - charge.completed (with payment_plan) → active
 *   - subscription.cancelled → canceled
 */

const secretHash = Deno.env.get("FLUTTERWAVE_WEBHOOK_HASH") || "";

serve(async (req) => {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const tenantId: string | null = pathParts.length > 3 ? pathParts[3] : null;

  // Verify hash
  if (secretHash) {
    const hash = req.headers.get("verif-hash") || "";
    if (hash !== secretHash) {
      console.error("Flutterwave hash mismatch");
      return new Response("Invalid hash", { status: 401 });
    }
  }

  const body = await req.text();
  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const eventType = event.event;
  const data = event.data;

  console.log(`Flutterwave event: ${eventType} | tenant=${tenantId || "self-hosted"}`);

  // Flutterwave doesn't have a native sandbox/live indicator in webhooks
  // Mode is inferred from key prefix or environment
  const mode: "test" | "live" = Deno.env.get("FLUTTERWAVE_TEST_MODE") === "true" ? "test" : "live";

  try {
    if (eventType === "charge.completed" && data?.payment_plan) {
      await handleSubscriptionEvent({
        email: data.customer?.email || null,
        provider: "flutterwave",
        customerId: data.customer?.id?.toString() || null,
        subscriptionId: data.payment_plan?.toString() || data.id?.toString(),
        plan: data.payment_plan?.toString() || "unknown",
        status: "active",
        mode,
        periodStart: data.created_at ? new Date(data.created_at) : null,
        periodEnd: null,
        cancelAtPeriodEnd: false,
        tenantId,
        eventType,
      });
    } else if (eventType === "subscription.cancelled") {
      await handleSubscriptionEvent({
        email: null,
        provider: "flutterwave",
        customerId: null,
        subscriptionId: data.id?.toString() || "unknown",
        plan: null,
        status: "canceled",
        mode,
        periodStart: null,
        periodEnd: null,
        cancelAtPeriodEnd: false,
        tenantId,
        eventType,
      });
    }
  } catch (err: any) {
    console.error("Flutterwave webhook error:", err);
    return new Response(`Error: ${err.message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
