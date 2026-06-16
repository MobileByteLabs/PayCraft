import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno";
import { handleSubscriptionEvent } from "../_shared/subscription-handler.ts";

/**
 * Cashfree PG webhook handler.
 *
 * URL paths:
 *   /functions/v1/cashfree-webhook/{tenant_id}   — multi-tenant (preferred)
 *   /functions/v1/cashfree-webhook               — single-tenant fallback
 *
 * Signature verification:
 *   Cashfree signs with HMAC-SHA256 over `timestamp + raw_body`, base64-encoded.
 *   Headers: `x-webhook-signature`, `x-webhook-timestamp`. The secret is the
 *   per-tenant webhook secret stored in tenant_providers.test_webhook_secret_enc
 *   (or live_webhook_secret_enc).
 *
 * Events handled today (PG Payment Links, one-time flow):
 *   PAYMENT_SUCCESS_WEBHOOK   → bump customer's subscription row to active
 *   PAYMENT_FAILED_WEBHOOK    → log + ignore (no row exists yet)
 *   PAYMENT_USER_DROPPED…     → log + ignore
 *
 * Subscription / UPI Autopay events (SUBSCRIPTION_AUTHORIZED_WEBHOOK,
 * SUBSCRIPTION_PAYMENT_SUCCESS_WEBHOOK, SUBSCRIPTION_CANCELLED_WEBHOOK) get
 * an explicit "ignored: not yet implemented" 200 so Cashfree stops retrying
 * — we'll wire those when UPI Autopay setup lands.
 *
 * link_id parsing: PayCraft generates link IDs as `pc-{tenant6}-{product6}-inr`
 * via cashfree-product-sync.ts. We parse those back to identify (tenant,
 * product) for the subscription update.
 */

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "http://kong:8000";
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

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
      p_provider: "cashfree",
      p_mode: mode,
    })
    .maybeSingle();
  if (error) {
    console.error(
      `[cashfree-webhook] decrypt failed (tenant=${tenantId}, mode=${mode}): ${error.message}`,
    );
    return null;
  }
  if (!data?.webhook_secret) return null;
  return { webhookSecret: data.webhook_secret };
}

/**
 * Verify Cashfree's signature. The signed string is the literal
 * concatenation `timestamp + raw_body`; HMAC is base64 of the SHA-256 digest.
 */
async function verifyCashfreeSignature(
  rawBody: string,
  timestamp: string,
  receivedSignature: string,
  secret: string,
): Promise<boolean> {
  if (!timestamp || !receivedSignature || !secret) return false;
  const signedData = `${timestamp}${rawBody}`;
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(signedData));
  const computed = btoa(
    String.fromCharCode(...new Uint8Array(sigBuf)),
  );
  // Constant-time-ish compare. crypto.subtle doesn't provide a built-in for
  // string equality; for short fixed-length b64 strings the JS == is
  // adequate against timing attacks at the public-internet level.
  return computed === receivedSignature;
}

/**
 * Parse a Cashfree link_id PayCraft generated. Format:
 *   pc-{tenant6}-{product6}-{currency_lower}
 * Returns null when the format doesn't match (third-party link not ours).
 */
function parsePaycraftLinkId(
  linkId: string,
): { tenantPrefix: string; productPrefix: string; currency: string } | null {
  const match = /^pc-([a-f0-9]{6,})-([a-f0-9]{6,})-([a-z]{3})$/.exec(linkId);
  if (!match) return null;
  return {
    tenantPrefix: match[1],
    productPrefix: match[2],
    currency: match[3].toUpperCase(),
  };
}

serve(async (req) => {
  const url = new URL(req.url);
  const pathParts = url.pathname.split("/").filter(Boolean);
  const tenantId: string | null = pathParts.length > 3 ? pathParts[3] : null;

  const timestamp = req.headers.get("x-webhook-timestamp") ?? "";
  const signature = req.headers.get("x-webhook-signature") ?? "";
  const rawBody = await req.text();

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("invalid JSON", { status: 400 });
  }

  // Cashfree doesn't expose livemode on the webhook payload directly. We
  // infer by attempting test secret first; if signature fails, try live.
  // The cost of two HMACs is trivial vs maintaining a per-event mode flag.
  let mode: "test" | "live" = "test";
  let secret = "";

  if (tenantId) {
    const testCreds = await loadTenantWebhookSecret(tenantId, "test");
    if (testCreds?.webhookSecret) {
      const ok = await verifyCashfreeSignature(
        rawBody,
        timestamp,
        signature,
        testCreds.webhookSecret,
      );
      if (ok) {
        secret = testCreds.webhookSecret;
        mode = "test";
      }
    }
    if (!secret) {
      const liveCreds = await loadTenantWebhookSecret(tenantId, "live");
      if (liveCreds?.webhookSecret) {
        const ok = await verifyCashfreeSignature(
          rawBody,
          timestamp,
          signature,
          liveCreds.webhookSecret,
        );
        if (ok) {
          secret = liveCreds.webhookSecret;
          mode = "live";
        }
      }
    }
  }

  if (!secret) {
    // Single-tenant fallback to env (legacy). Unused in multi-tenant deploys.
    const envSecret =
      Deno.env.get("CASHFREE_WEBHOOK_SECRET") ??
      Deno.env.get("CASHFREE_TEST_WEBHOOK_SECRET") ??
      "";
    if (envSecret) {
      const ok = await verifyCashfreeSignature(
        rawBody,
        timestamp,
        signature,
        envSecret,
      );
      if (ok) secret = envSecret;
    }
  }

  if (!secret) {
    console.error(
      `[cashfree-webhook] signature verification failed (tenant=${tenantId ?? "self-hosted"})`,
    );
    return new Response("invalid signature", { status: 401 });
  }

  const eventType = payload.type as string;
  console.log(
    `[cashfree-webhook] event=${eventType} mode=${mode} tenant=${tenantId ?? "self-hosted"}`,
  );

  // Service-role client for DB writes.
  const supabase = SERVICE_ROLE
    ? createClient(SUPABASE_URL, SERVICE_ROLE, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

  try {
    switch (eventType) {
      case "PAYMENT_SUCCESS_WEBHOOK": {
        const link = payload?.data?.link;
        const customer = payload?.data?.customer_details;
        const order = payload?.data?.order;
        if (!link?.link_id) {
          return ackIgnore("PAYMENT_SUCCESS without link_id (not a PayCraft link)");
        }
        const parsed = parsePaycraftLinkId(link.link_id);
        if (!parsed) {
          return ackIgnore(
            `link_id ${link.link_id} doesn't match PayCraft format — third-party link`,
          );
        }
        const email = customer?.customer_email;
        if (!email) {
          return ackIgnore("PAYMENT_SUCCESS without customer_email");
        }
        // Look up the real tenant_id / product_id via prefix match (since
        // link_id only carries 6 hex chars of each).
        if (!supabase) return ackIgnore("no service role");
        const { data: products } = await supabase
          .from("tenant_products")
          .select("id, sku, tenant_id, type, interval, trial_duration_days")
          .ilike("id", `${parsed.productPrefix}%`)
          .ilike("tenant_id", `${parsed.tenantPrefix}%`);
        if (!products || products.length === 0) {
          return ackIgnore(
            `no PayCraft product matching prefix ${parsed.productPrefix}`,
          );
        }
        const product = products[0];
        await handleSubscriptionEvent({
          email,
          provider: "cashfree",
          customerId: customer?.customer_phone ?? customer?.customer_id ?? null,
          subscriptionId: `cashfree-link-${link.link_id}`,
          plan: product.sku,
          status: "active",
          mode,
          periodStart: new Date(),
          periodEnd: computePeriodEnd(product),
          cancelAtPeriodEnd: false,
          trialStart: null,
          trialEnd: null,
          tenantId: product.tenant_id,
          eventType,
        });
        return new Response(JSON.stringify({ received: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }

      case "PAYMENT_FAILED_WEBHOOK":
      case "PAYMENT_USER_DROPPED_WEBHOOK":
        return ackIgnore(`${eventType} — no subscription to update`);

      case "SUBSCRIPTION_AUTHORIZED_WEBHOOK":
      case "SUBSCRIPTION_PAYMENT_SUCCESS_WEBHOOK":
      case "SUBSCRIPTION_CANCELLED_WEBHOOK":
        // UPI Autopay flows — not yet implemented. Ack to stop retries.
        return ackIgnore(`${eventType} — UPI Autopay handling not implemented`);

      default:
        return ackIgnore(`unknown event type ${eventType}`);
    }
  } catch (err) {
    console.error("[cashfree-webhook] processing error:", err);
    return new Response(`processing error: ${(err as Error).message}`, {
      status: 500,
    });
  }
});

function ackIgnore(reason: string): Response {
  return new Response(
    JSON.stringify({ received: true, ignored: true, reason }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

function computePeriodEnd(product: {
  type: string;
  interval: string | null;
  trial_duration_days: number | null;
}): Date {
  const now = new Date();
  if (product.type === "lifetime") {
    const far = new Date(now);
    far.setFullYear(far.getFullYear() + 100);
    return far;
  }
  if (product.type === "trial") {
    const days = product.trial_duration_days ?? 7;
    return new Date(now.getTime() + days * 86_400_000);
  }
  const next = new Date(now);
  switch (product.interval) {
    case "month":
      next.setMonth(next.getMonth() + 1);
      break;
    case "quarter":
      next.setMonth(next.getMonth() + 3);
      break;
    case "semiannual":
      next.setMonth(next.getMonth() + 6);
      break;
    case "year":
      next.setFullYear(next.getFullYear() + 1);
      break;
    default:
      next.setMonth(next.getMonth() + 1);
  }
  return next;
}
