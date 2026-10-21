import { supabaseAdmin } from "./supabase-admin.ts";

/**
 * Credit a CONSUMABLE / one-time purchase to the buyer's balance — the provider-agnostic
 * counterpart to `handleSubscriptionEvent`.
 *
 * ## Why this exists
 *
 * Every piece of the consumable economy shipped except the one that moves the money: the ledger,
 * the grant RPC, the client `balances`/`spend` surface and the store sync all existed, and
 * `entitlement_balance_grant` had **zero callers**. A tenant could create a coin pack, sync it to
 * Play, the App Store, Stripe and Razorpay, sell it — and the buyer's balance would never move, on
 * any provider. Nothing errored; the money simply arrived and the goods never did.
 *
 * It is deliberately ONE shared function rather than per-provider logic. The provider differences
 * that matter here are only "what did they call the sku" and "what is the stable transaction id";
 * the decision of how much to grant belongs to the CATALOGUE, not to a webhook. Six copies of that
 * decision is six chances for one provider to grant a different amount than the others.
 *
 * ## The amount is never taken from the provider
 *
 * `grant_quantity` is read from `tenant_products` by sku. A webhook payload is attacker-adjacent
 * for self-hosted deployments and, more mundanely, can be stale after a catalogue edit — so a
 * provider-supplied quantity would let the wrong number into the ledger. The catalogue is the only
 * authority on what a pack is worth (the same reason the client cannot choose it, AR-013).
 *
 * ## Idempotency
 *
 * Providers redeliver. `entitlement_balance_grant` absorbs a duplicate via
 * `ON CONFLICT (tenant_id, idempotency_key) DO NOTHING` and still returns the current balance, so
 * the caller cannot tell a redelivery from a first delivery — which is correct, because a webhook
 * retry is normal traffic, not a fault. The key must therefore be stable per PURCHASE, which is
 * what `stableTxnId` is for: Stripe's payment_intent, Razorpay's payment id, Play's purchaseToken,
 * Apple's originalTransactionId. A per-call random key would grant every redelivery again.
 */
export interface ConsumablePurchaseEvent {
  /** Tenant from the webhook URL path. NULL is refused — an unattributed grant is unspendable. */
  tenantId: string | null;
  /** Buyer identity. Email is the only identifier every provider carries. */
  email: string | null;
  /**
   * Catalogue sku as the provider knows it (Stripe `plan_id` metadata, Play productId, …).
   * Either this OR [productId] must be present.
   */
  sku?: string | null;
  /**
   * PayCraft product UUID, when that is what the provider carries instead of the sku — Razorpay
   * payment links are created with `notes.paycraft_product_id`. Providers differ in which
   * identifier survives the round trip, and forcing one would mean rewriting integrations that
   * already work; resolving either here keeps that difference out of every webhook.
   */
  productId?: string | null;
  /** Stable per-purchase id — the idempotency anchor. */
  stableTxnId: string | null;
  provider: string;
  /** Provider event name, for the failure message only. */
  eventType?: string;
}

export interface ConsumableGrantResult {
  granted: boolean;
  /** Units credited (the catalogue's grant_quantity), or 0 when nothing was granted. */
  quantity: number;
  /** Balance after the grant, as the server computed it. */
  balance?: number;
  /** Why nothing was granted. Present only when `granted` is false. */
  reason?: string;
}

export async function handleConsumablePurchase(
  event: ConsumablePurchaseEvent,
): Promise<ConsumableGrantResult> {
  const { tenantId, email, stableTxnId, provider } = event;
  const sku = event.sku ?? null;
  const productId = event.productId ?? null;

  // Every one of these is a REFUSAL, not a silent skip. A grant that cannot be attributed is money
  // the buyer paid and cannot spend, and the only way anyone finds out is a support ticket — so
  // each failure names exactly what was missing.
  if (!tenantId) return { granted: false, quantity: 0, reason: "no tenant_id on the webhook URL" };
  if (!email) return { granted: false, quantity: 0, reason: "no buyer email on the event" };
  if (!sku && !productId) {
    return { granted: false, quantity: 0, reason: "no sku or product id on the event" };
  }
  if (!stableTxnId) {
    // Without a stable id there is no safe idempotency key, and granting under a random one would
    // credit the pack again on every redelivery. Refusing is the conservative failure.
    return { granted: false, quantity: 0, reason: "no stable transaction id on the event" };
  }

  // The catalogue decides the amount — never the payload.
  const lookup = supabaseAdmin
    .from("tenant_products")
    .select("sku, type, grant_quantity")
    .eq("tenant_id", tenantId);
  const { data: product, error: productError } = await (
    sku ? lookup.eq("sku", sku) : lookup.eq("id", productId)
  ).maybeSingle();
  const label = sku ?? productId;

  if (productError) {
    return { granted: false, quantity: 0, reason: `catalogue lookup failed: ${productError.message}` };
  }
  if (!product) {
    return { granted: false, quantity: 0, reason: `${label} is not in this tenant's catalogue` };
  }
  // A subscription landing here is a ROUTING bug in the caller, not a product to grant. Say so
  // rather than crediting zero and reporting success.
  if (product.type !== "consumable" && product.type !== "one_time") {
    return { granted: false, quantity: 0, reason: `${label} is a ${product.type}, not a consumable` };
  }
  const quantity = Number(product.grant_quantity ?? 0);
  if (!(quantity > 0)) {
    // The API refuses to CREATE such a product, so this is a row that predates that rule or was
    // written directly to the database. Loud, because the buyer has already been charged.
    return {
      granted: false,
      quantity: 0,
      reason: `${label} has grant_quantity ${quantity} — the buyer was charged and would receive nothing`,
    };
  }

  // Mint-or-find the buyer's entitlement subject. The same resolver the subscription path uses, so
  // a customer who subscribes AND buys a pack is one subject with one balance, not two identities.
  const { data: subjectId, error: subjectError } = await supabaseAdmin.rpc(
    "entitlement_subject_resolve",
    { p_kind: "email", p_provider: null, p_value: email, p_verified: false },
  );
  if (subjectError || !subjectId) {
    return {
      granted: false,
      quantity: 0,
      reason: `could not resolve a subject for ${email}: ${subjectError?.message ?? "no id returned"}`,
    };
  }

  // Key on the provider AND its transaction id. Two providers could theoretically mint the same
  // opaque id, and the ledger's uniqueness is per tenant — so the provider prefix is what keeps
  // one provider's retry from absorbing another provider's genuine purchase.
  const idempotencyKey = `${provider}:${stableTxnId}`;

  const { data: balance, error: grantError } = await supabaseAdmin.rpc("entitlement_balance_grant", {
    p_tenant_id: tenantId,
    p_subject_id: subjectId,
    p_sku: product.sku,
    p_quantity: quantity,
    p_stable_txn_id: stableTxnId,
    p_idempotency_key: idempotencyKey,
  });

  if (grantError) {
    return { granted: false, quantity: 0, reason: `grant failed: ${grantError.message}` };
  }

  return { granted: true, quantity, balance: typeof balance === "number" ? balance : undefined };
}
