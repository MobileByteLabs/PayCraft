import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";
import { handleSubscriptionEvent } from "../_shared/subscription-handler.ts";

/**
 * Multi-tenant Razorpay Webhook Handler.
 *
 * URL paths:
 *   /functions/v1/razorpay-webhook/{tenant_id}   — multi-tenant (preferred)
 *   /functions/v1/razorpay-webhook               — single-tenant fallback
 *
 * Credential resolution (matches the Stripe + Cashfree pattern after the
 * Phase B-C rewrites):
 *   1. If {tenant_id} in path → load test+live webhook secrets from
 *      tenant_providers via tenant_providers_decrypt_for_webhook (RPC
 *      added in migration 059 — service-role only).
 *   2. Otherwise fall back to env vars (legacy single-tenant deploys).
 *
 * Without this, multi-tenant deploys can't process Razorpay events at all
 * — each tenant has their own whsec_ in the Razorpay Dashboard but the
 * Edge Function would only have one global secret in env.
 *
 * Events handled:
 *   subscription.activated   → active OR trialing (when start_at > now)
 *   subscription.charged     → period extension (renewal)
 *   subscription.cancelled   → canceled
 *   subscription.halted      → past_due (recurring charge failed)
 *   subscription.completed   → canceled (subscription lifecycle ended)
 *
 * Trial detection: Razorpay's `subscription.start_at` (unix seconds). If
 * start_at > created_at at activation, the user is in a trial window
 * [created_at, start_at). We populate trial_start/trial_end accordingly;
 * the sticky trigger from migration 027 preserves them across renewals.
 *
 * Email resolution: Razorpay doesn't expose customer email on subscription
 * objects directly. The adopt-flow stores it in `subscription.notes` at
 * creation time as `paycraft_email`. If missing we update by
 * subscriptionId only.
 *
 * For unhandled events: ack with 200 + ignored:true so Razorpay stops
 * retrying. The behavior matches the post-rewrite Stripe webhook.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "http://kong:8000";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

// Legacy env fallbacks (single-tenant self-hosters).
const envTestWebhookSecret =
  Deno.env.get("RAZORPAY_TEST_WEBHOOK_SECRET") ??
  Deno.env.get("RAZORPAY_WEBHOOK_SECRET") ??
  "";
const envLiveWebhookSecret =
  Deno.env.get("RAZORPAY_LIVE_WEBHOOK_SECRET") ??
  Deno.env.get("RAZORPAY_WEBHOOK_SECRET") ??
  "";

interface RazorpaySubscription {
  id: string;
  plan_id: string;
  customer_id: string | null;
  status: string;
  created_at: number;
  current_start: number | null;
  current_end: number | null;
  start_at: number | null;
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

interface TenantCreds {
  webhookSecret: string;
}

async function loadTenantWebhookSecret(
  tenantId: string,
  mode: "test" | "live",
): Promise<TenantCreds | null> {
  if (!SERVICE_ROLE) return null;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await admin
    .rpc("tenant_providers_decrypt_for_webhook", {
      p_tenant_id: tenantId,
      p_provider: "razorpay",
      p_mode: mode,
    })
    .maybeSingle();
  if (error) {
    console.error(
      `[razorpay-webhook] decrypt failed (tenant=${tenantId}, mode=${mode}): ${error.message}`,
    );
    return null;
  }
  if (!data?.webhook_secret) return null;
  return { webhookSecret: data.webhook_secret };
}

async function verifySignature(
  body: string,
  signature: string,
  secret: string,
): Promise<boolean> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  const expected = Array.from(new Uint8Array(sigBuf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  // Razorpay sends lowercase hex; case-insensitive compare is the safe path.
  return expected.toLowerCase() === signature.toLowerCase();
}

serve(async (req) => {
  const signature = req.headers.get("x-razorpay-signature");
  if (!signature) {
    return new Response("Missing x-razorpay-signature", { status: 400 });
  }

  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const tenantId: string | null = pathParts.length > 3 ? pathParts[3] : null;

  const body = await req.text();

  let parsed: RazorpayEventEnvelope;
  try {
    parsed = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  // Resolve mode via notes hint (most reliable when set), then by which
  // secret verifies. The notes hint is set by PayCraft's adopt-flow when
  // creating the subscription; if absent, we try test then live.
  const noteMode = parsed.payload?.subscription?.entity?.notes?.paycraft_mode;
  const claimedMode: "test" | "live" | null =
    noteMode === "test" ? "test" : noteMode === "live" ? "live" : null;

  let resolvedMode: "test" | "live" | null = null;

  // Helper: try a (mode, secret) pair against the signature.
  async function trySecret(
    mode: "test" | "live",
    secret: string | null | undefined,
  ): Promise<boolean> {
    if (!secret) return false;
    return await verifySignature(body, signature!, secret);
  }

  // Tenant-scoped secrets first.
  if (tenantId) {
    if (claimedMode) {
      const creds = await loadTenantWebhookSecret(tenantId, claimedMode);
      if (await trySecret(claimedMode, creds?.webhookSecret)) {
        resolvedMode = claimedMode;
      }
    } else {
      const testCreds = await loadTenantWebhookSecret(tenantId, "test");
      if (await trySecret("test", testCreds?.webhookSecret)) {
        resolvedMode = "test";
      } else {
        const liveCreds = await loadTenantWebhookSecret(tenantId, "live");
        if (await trySecret("live", liveCreds?.webhookSecret)) {
          resolvedMode = "live";
        }
      }
    }
  }

  // Env-var fallback for single-tenant deploys.
  if (!resolvedMode) {
    if (claimedMode) {
      const secret = claimedMode === "test" ? envTestWebhookSecret : envLiveWebhookSecret;
      if (await trySecret(claimedMode, secret)) resolvedMode = claimedMode;
    } else {
      if (await trySecret("test", envTestWebhookSecret)) resolvedMode = "test";
      else if (await trySecret("live", envLiveWebhookSecret)) resolvedMode = "live";
    }
  }

  if (!resolvedMode) {
    console.error(
      `[razorpay-webhook] signature verification failed (tenant=${tenantId ?? "self-hosted"})`,
    );
    return new Response("Invalid signature", { status: 401 });
  }

  const mode = resolvedMode;
  const eventType = parsed.event;
  const sub = parsed.payload?.subscription?.entity;

  console.log(
    `[razorpay-webhook] event=${eventType} mode=${mode} tenant=${tenantId ?? "self-hosted"}`,
  );

  if (!sub) {
    // payment.* events without a subscription envelope — ack and ignore,
    // PayCraft only cares about subscription state.
    return new Response(
      JSON.stringify({ received: true, ignored: true, reason: "no subscription payload" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  const trialStart =
    sub.start_at && sub.created_at && sub.start_at > sub.created_at
      ? new Date(sub.created_at * 1000)
      : null;
  const trialEnd =
    sub.start_at && sub.created_at && sub.start_at > sub.created_at
      ? new Date(sub.start_at * 1000)
      : null;
  const inTrialWindow = trialEnd !== null && trialEnd > new Date();

  const email = sub.notes?.paycraft_email || sub.notes?.email || null;
  const plan = sub.notes?.paycraft_plan || sub.plan_id || "unknown";

  try {
    switch (eventType) {
      case "subscription.activated": {
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
        await handleSubscriptionEvent({
          email: null,
          provider: "razorpay",
          customerId: null,
          subscriptionId: sub.id,
          plan: null,
          status: "active",
          mode,
          periodStart: sub.current_start ? new Date(sub.current_start * 1000) : null,
          periodEnd: sub.current_end ? new Date(sub.current_end * 1000) : null,
          cancelAtPeriodEnd: false,
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

      default:
        return new Response(
          JSON.stringify({
            received: true,
            ignored: true,
            reason: `event ${eventType} not handled`,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[razorpay-webhook] processing error:", message);
    return new Response(`Error: ${message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
});
