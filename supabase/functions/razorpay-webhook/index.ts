import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { handleSubscriptionEvent } from "../_shared/subscription-handler.ts";

/**
 * Razorpay Webhook Handler.
 *
 * Razorpay signs webhooks with HMAC-SHA256 in the `x-razorpay-signature`
 * header using the secret you configured in Dashboard → Webhooks → Edit.
 *
 * Events handled (subscribe to these in the Razorpay dashboard):
 *   - subscription.activated   → active OR trialing (when start_at > now)
 *   - subscription.charged     → period extension (renewal — sets new current_end)
 *   - subscription.cancelled   → canceled
 *   - subscription.halted      → past_due (payment failed)
 *   - subscription.completed   → canceled (end of subscription lifecycle)
 *
 * Trial support (PayCraft v1.1):
 *   Razorpay's "scheduled first invoice" pattern uses `subscription.start_at`
 *   (Unix seconds). If start_at > now() at activation, the user is in a free
 *   trial that ends at start_at. We map:
 *     trial_start = subscription.created_at (when the trial started)
 *     trial_end   = subscription.start_at   (when first charge will fire)
 *   Once trial expires, subsequent events leave the trial columns alone (the
 *   sticky-trigger from migration 027 preserves them).
 *
 * URL path supports optional tenant ID (multi-tenant cloud mode):
 *   /razorpay-webhook              → single-tenant (self-hosted)
 *   /razorpay-webhook/{tenant_id}  → multi-tenant
 *
 * Email resolution:
 *   Razorpay subscription objects don't include customer email directly. The
 *   adopt-flow stores email in `subscription.notes.paycraft_email` at creation
 *   time; we read it here. If missing, we fall through with email=null and
 *   the shared handler updates by subscription_id only.
 */

const testKeyId = Deno.env.get("RAZORPAY_TEST_KEY_ID") || "";
const liveKeyId = Deno.env.get("RAZORPAY_LIVE_KEY_ID") || "";
const testWebhookSecret = Deno.env.get("RAZORPAY_TEST_WEBHOOK_SECRET") || Deno.env.get("RAZORPAY_WEBHOOK_SECRET") || "";
const liveWebhookSecret = Deno.env.get("RAZORPAY_LIVE_WEBHOOK_SECRET") || Deno.env.get("RAZORPAY_WEBHOOK_SECRET") || "";

interface RazorpaySubscription {
  id: string;
  plan_id: string;
  customer_id: string | null;
  status: string;
  created_at: number;       // unix seconds
  current_start: number | null;
  current_end: number | null;
  start_at: number | null;  // unix seconds — first charge time; trial_end if > created_at
  ended_at: number | null;
  notes: Record<string, string> | null;
}

interface RazorpayEventEnvelope {
  entity: "event";
  account_id: string;
  event: string;
  contains: string[];
  payload: {
    subscription?: { entity: RazorpaySubscription };
    payment?: { entity: Record<string, unknown> };
  };
  created_at: number;
}

serve(async (req) => {
  const signature = req.headers.get("x-razorpay-signature");
  if (!signature) {
    return new Response("Missing x-razorpay-signature", { status: 400 });
  }

  // Tenant ID from URL path: /functions/v1/razorpay-webhook/{tenant_id}
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const tenantId: string | null = pathParts.length > 3 ? pathParts[3] : null;

  const body = await req.text();

  // Derive mode from raw payload BEFORE signature verification, mirroring
  // the Stripe webhook's dual-mode pattern. Razorpay events include
  // `payload.subscription.entity.notes.paycraft_mode` if set during creation,
  // OR we fall back to checking which webhook secret verifies.
  let parsed: RazorpayEventEnvelope;
  try {
    parsed = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const noteMode = parsed.payload?.subscription?.entity?.notes?.paycraft_mode;
  const claimedMode: "test" | "live" | null =
    noteMode === "test" ? "test" : noteMode === "live" ? "live" : null;

  // Verify signature against the secret matching the claimed mode; if no claim,
  // try test first then live (Razorpay doesn't include livemode in payload).
  let mode: "test" | "live";
  if (claimedMode) {
    const secret = claimedMode === "test" ? testWebhookSecret : liveWebhookSecret;
    if (!secret || !(await verifySignature(body, signature, secret))) {
      console.error(`Razorpay ${claimedMode}-mode signature verification failed`);
      return new Response("Invalid signature", { status: 401 });
    }
    mode = claimedMode;
  } else if (testWebhookSecret && (await verifySignature(body, signature, testWebhookSecret))) {
    mode = "test";
  } else if (liveWebhookSecret && (await verifySignature(body, signature, liveWebhookSecret))) {
    mode = "live";
  } else {
    console.error("Razorpay signature verification failed (no matching secret)");
    return new Response("Invalid signature", { status: 401 });
  }

  const eventType = parsed.event;
  const sub = parsed.payload?.subscription?.entity;
  if (!sub) {
    // payment.* events without a subscription envelope are acknowledged but ignored
    // (PayCraft cares about subscription state, not standalone payments).
    console.log(`Razorpay event ${eventType} has no subscription payload — skipping`);
    return new Response(JSON.stringify({ received: true, skipped: true }), { status: 200 });
  }

  console.log(`Razorpay event: ${eventType} | sub=${sub.id} | mode=${mode} | tenant=${tenantId || "self-hosted"}`);

  // Trial detection: if start_at > created_at, the user got a scheduled first
  // invoice (= trial window from created_at → start_at).
  const trialStart =
    sub.start_at && sub.created_at && sub.start_at > sub.created_at
      ? new Date(sub.created_at * 1000)
      : null;
  const trialEnd =
    sub.start_at && sub.created_at && sub.start_at > sub.created_at
      ? new Date(sub.start_at * 1000)
      : null;
  const inTrialWindow = trialEnd !== null && trialEnd > new Date();

  // Email resolution from notes (set by adopt-flow at subscription creation).
  const email = sub.notes?.paycraft_email || sub.notes?.email || null;
  const plan = sub.notes?.paycraft_plan || sub.plan_id || "unknown";

  try {
    switch (eventType) {
      case "subscription.activated": {
        // activated fires when the subscription becomes billable. With a trial,
        // the actual status is "trialing" until start_at; afterwards it's "active".
        const status = inTrialWindow ? "trialing" : "active";
        await handleSubscriptionEvent({
          email,
          provider: "razorpay",
          customerId: sub.customer_id,
          subscriptionId: sub.id,
          plan,
          status,
          mode,
          periodStart: sub.current_start ? new Date(sub.current_start * 1000) : null,
          periodEnd: sub.current_end ? new Date(sub.current_end * 1000) : trialEnd,
          cancelAtPeriodEnd: false,
          trialStart,
          trialEnd,
          tenantId,
          eventType,
        });
        break;
      }

      case "subscription.charged": {
        // Renewal — Razorpay charged a new billing period.
        await handleSubscriptionEvent({
          email: null,  // partial update by subscriptionId
          provider: "razorpay",
          customerId: null,
          subscriptionId: sub.id,
          plan: null,
          status: "active",
          mode,
          periodStart: sub.current_start ? new Date(sub.current_start * 1000) : null,
          periodEnd: sub.current_end ? new Date(sub.current_end * 1000) : null,
          cancelAtPeriodEnd: false,
          // trialStart/trialEnd intentionally omitted — sticky trigger preserves history.
          tenantId,
          eventType,
        });
        break;
      }

      case "subscription.cancelled":
      case "subscription.completed": {
        await handleSubscriptionEvent({
          email: null,
          provider: "razorpay",
          customerId: null,
          subscriptionId: sub.id,
          plan: null,
          status: "canceled",
          mode,
          periodStart: null,
          periodEnd: sub.ended_at ? new Date(sub.ended_at * 1000) : null,
          cancelAtPeriodEnd: true,
          tenantId,
          eventType,
        });
        break;
      }

      case "subscription.halted": {
        // Razorpay halts a subscription when a recurring charge fails.
        await handleSubscriptionEvent({
          email: null,
          provider: "razorpay",
          customerId: null,
          subscriptionId: sub.id,
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

      default: {
        // Acknowledge unrecognized events without writing to the DB.
        console.log(`Razorpay event ${eventType} not handled — acknowledged`);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Razorpay webhook error:", message);
    return new Response(`Error: ${message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});

async function verifySignature(body: string, signature: string, secret: string): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  const expected = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // Razorpay sends lowercase hex; case-insensitive compare is the safe path.
  return expected.toLowerCase() === signature.toLowerCase();
}
