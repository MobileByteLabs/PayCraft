import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handleSubscriptionEvent } from "../_shared/subscription-handler.ts";

/**
 * BTCPay Server Webhook Handler.
 *
 * BTCPay sends webhook notifications with HMAC-SHA256 in `BTCPay-Sig` header.
 * Format: "sha256=HEXDIGEST"
 *
 * Events handled:
 *   - InvoiceSettled → active (payment confirmed)
 *   - InvoiceExpired → canceled (payment window expired)
 *   - InvoiceInvalid → canceled (double-spend or underpayment)
 */

const webhookSecret = Deno.env.get("BTCPAY_WEBHOOK_SECRET") || "";

serve(async (req) => {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const tenantId: string | null = pathParts.length > 3 ? pathParts[3] : null;

  const body = await req.text();

  // Verify BTCPay HMAC signature
  if (webhookSecret) {
    const sigHeader = req.headers.get("btcpay-sig") || "";
    const expectedSig = sigHeader.replace("sha256=", "");
    const key = new TextEncoder().encode(webhookSecret);
    const data = new TextEncoder().encode(body);
    const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("HMAC", cryptoKey, data);
    const computed = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
    if (computed !== expectedSig) {
      console.error("BTCPay signature mismatch");
      return new Response("Invalid signature", { status: 401 });
    }
  }

  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const eventType = event.type;
  console.log(`BTCPay event: ${eventType} | invoice=${event.invoiceId} | tenant=${tenantId || "self-hosted"}`);

  // BTCPay is self-hosted, always "live" (no sandbox concept)
  const mode: "test" | "live" = "live";

  try {
    switch (eventType) {
      case "InvoiceSettled": {
        // Extract email and plan from invoice metadata
        const metadata = event.metadata || {};
        await handleSubscriptionEvent({
          email: metadata.buyerEmail || metadata.email || null,
          provider: "btcpay",
          customerId: null,
          subscriptionId: event.invoiceId,
          plan: metadata.plan_id || metadata.planId || "unknown",
          status: "active",
          mode,
          periodStart: new Date(),
          periodEnd: null, // Bitcoin payments are typically one-time; app logic handles expiry
          cancelAtPeriodEnd: false,
          tenantId,
          eventType,
        });
        break;
      }
      case "InvoiceExpired":
      case "InvoiceInvalid": {
        await handleSubscriptionEvent({
          email: null,
          provider: "btcpay",
          customerId: null,
          subscriptionId: event.invoiceId,
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
    }
  } catch (err: any) {
    console.error("BTCPay webhook error:", err);
    return new Response(`Error: ${err.message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
