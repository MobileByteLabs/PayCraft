import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { withWebhookRateLimit } from "../_shared/webhook-rate-limit.ts";
import { tenantIdFromPath } from "../_shared/webhook-path.ts";
import { razorpayNotesProductId, razorpayNotesTenantId } from "../_shared/razorpay-tenant.ts";
import { razorpaySubscriptionState } from "../_shared/razorpay-subscription-state.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.1?target=deno";
import { handleConsumablePurchase } from "../_shared/consumable-handler.ts";
import { handleSubscriptionEvent } from "../_shared/subscription-handler.ts";
import { razorpayAttempt, recordAttempt } from "../_shared/checkout-attempts.ts";
import { supabaseAdmin } from "../_shared/supabase-admin.ts";

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

/** The app that owns a product — how a consumable Payment Link (notes carry only the product) finds its tenant. */
async function tenantIdForProduct(productId: string | null): Promise<string | null> {
  if (!productId || !SERVICE_ROLE) return null;
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data } = await admin.from("tenant_products").select("tenant_id").eq("id", productId).maybeSingle();
  return (data as { tenant_id?: string } | null)?.tenant_id ?? null;
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
    .maybeSingle<{ secret_key: string | null; webhook_secret: string | null; key_id: string | null; credential: string | null }>();
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

serve(withWebhookRateLimit({ bucket: "webhook:razorpay" }, async (req) => {
  const signature = req.headers.get("x-razorpay-signature");
  if (!signature) {
    return new Response("Missing x-razorpay-signature", { status: 400 });
  }

  const body = await req.text();

  let parsed: RazorpayEventEnvelope;
  try {
    parsed = JSON.parse(body);
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  // The path names the app for a per-app account. A SHARED org account (one Razorpay account
  // attached to several apps) can register only one URL, so it arrives tenant-less: take the app
  // from the notes PayCraft stamped, or from the product a consumable Payment Link names. Either is
  // only a claim — the signature below must still verify with THAT tenant's webhook secret.
  const tenantId: string | null = tenantIdFromPath(req.url, "razorpay-webhook") ??
    razorpayNotesTenantId(parsed) ??
    await tenantIdForProduct(razorpayNotesProductId(parsed));

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
    // A captured PAYMENT with no subscription envelope is how a one-time / consumable purchase
    // arrives — Razorpay Payment Links are the lane razorpay-product-sync creates for exactly
    // those products. Until 2026-10-20 this branch acked and ignored every such event ("PayCraft
    // only cares about subscription state"), so a coin pack bought through Razorpay charged the
    // customer and credited nothing.
    //
    // The link is created with notes.paycraft_product_id (a UUID, not the sku) — see
    // razorpay-product-sync.ts — so the product id is what gets threaded through.
    const payment = parsed.payload?.payment?.entity as
      | { id?: string; email?: string; notes?: Record<string, string> }
      | undefined;
    const notes = payment?.notes ?? {};
    if (eventType === "payment.captured" && payment) {
      const grant = await handleConsumablePurchase({
        tenantId,
        email: payment.email || notes.paycraft_email || null,
        productId: notes.paycraft_product_id || null,
        sku: notes.paycraft_plan || null,
        stableTxnId: payment.id ?? null,
        provider: "razorpay",
        eventType,
      });
      if (grant.granted) {
        console.log(
          `[razorpay-webhook] granted ${grant.quantity} to ${payment.email ?? "unknown"} (balance ${grant.balance})`,
        );
        return new Response(
          JSON.stringify({ received: true, granted: grant.quantity, balance: grant.balance }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      // Not one of our consumables → the old ack-and-ignore. Anything else is logged: the customer
      // has already been charged, so a refusal must leave a trace an operator can act on.
      if (
        grant.reason &&
        !grant.reason.includes("not in this tenant's catalogue") &&
        !grant.reason.includes("not a consumable") &&
        !grant.reason.includes("no sku or product id")
      ) {
        console.error(`[razorpay-webhook] consumable grant refused: ${grant.reason}`);
      }
    }

    // A failed payment or an expired link is someone who TRIED to buy — the customer list's "tried"
    // rows (checkout_attempts, migration 186). Recorded, then acked like any other non-subscription event.
    const attempt = razorpayAttempt(eventType, parsed.payload, tenantId, mode);
    if (attempt) {
      try {
        await recordAttempt(supabaseAdmin, attempt);
      } catch (e) {
        console.error(`[razorpay-webhook] ${(e as Error).message}`);
        return new Response(`Error: ${(e as Error).message}`, { status: 500 });
      }
      return new Response(JSON.stringify({ received: true, attempt: attempt.outcome }), {
        status: 200, headers: { "Content-Type": "application/json" },
      });
    }

    // Other payment.* events without a subscription envelope — ack and ignore.
    return new Response(
      JSON.stringify({ received: true, ignored: true, reason: "no subscription payload" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  // One mapping for the whole Razorpay lifecycle (incl. `authenticated` = a trial has started), shared
  // with its tests — see _shared/razorpay-subscription-state.ts.
  const state = razorpaySubscriptionState(eventType, sub);

  try {
    if (!state) {
      return new Response(
        JSON.stringify({ received: true, ignored: true, reason: `event ${eventType} not handled` }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }
    await handleSubscriptionEvent({
      email: state.email,
      provider: "razorpay",
      customerId: state.customerId,
      subscriptionId: sub.id,
      plan: state.plan,
      status: state.status,
      mode,
      periodStart: state.periodStart,
      periodEnd: state.periodEnd,
      cancelAtPeriodEnd: state.cancelAtPeriodEnd,
      ...(state.trialEnd ? { trialStart: state.trialStart, trialEnd: state.trialEnd } : {}),
      tenantId,
      eventType,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[razorpay-webhook] processing error:", message);
    return new Response(`Error: ${message}`, { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}));
