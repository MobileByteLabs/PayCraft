import { resolveInboundTenant } from "./inbound-tenant.ts";
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
  /**
   * Tenant from the webhook URL path. NULL is refused for the web PSPs — an unattributed grant is
   * unspendable. The STORE lanes are the exception: Play's Pub/Sub topic and Apple's ASSN endpoint
   * are per-DEPLOYMENT, not per-tenant (which is why `entitlement-reconcile` records
   * `tenantId: null` for both), so they pass [storeProductId] instead and the tenant is derived
   * from the catalogue row that owns that store id.
   */
  tenantId: string | null;
  /**
   * Buyer email — the identifier every web PSP carries. Sugar for `identity: {kind:"email"}`.
   * Stores do not have one; they pass [identity] with the app's own user id instead.
   */
  email?: string | null;
  /**
   * Explicit buyer identity, for providers that do not carry an email.
   *
   * `kind` is constrained by `entitlement_identities_kind_check` to
   * `email | oauth | device | auth_user`. A store purchase arrives with the app-supplied account
   * id — Play's `obfuscatedExternalAccountId`, Apple's `appAccountToken` — which is `auth_user`.
   */
  identity?: { kind: "email" | "oauth" | "device" | "auth_user"; provider?: string | null; value: string };
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
  /**
   * The id the STORE knows the product by (`tenant_products.play_product_id` /
   * `.app_store_product_id`), written back by the product sync.
   */
  storeProductId?: string | null;
  /**
   * The APP the purchase happened in — Play's `packageName`, Apple's `bundleId`. This is how a
   * store purchase is attributed to a tenant, matching how the rest of the system scopes:
   * `tenants.app_identifier` (migration 111) is owned by the app and read by both stores.
   *
   * Required for the store lanes, and it is NOT interchangeable with resolving on the product id
   * alone: two tenants can both sell a sku called `coins_550`, so a product-only lookup either
   * errors on multiple rows or silently attributes one tenant's purchase to another's ledger.
   */
  appIdentifier?: string | null;
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
  const { stableTxnId, provider } = event;
  const sku = event.sku ?? null;
  const productId = event.productId ?? null;
  const storeProductId = event.storeProductId ?? null;
  const appIdentifier = event.appIdentifier ?? null;
  const identity = event.identity ??
    (event.email ? { kind: "email" as const, provider: null, value: event.email } : null);

  // Every one of these is a REFUSAL, not a silent skip. A grant that cannot be attributed is money
  // the buyer paid and cannot spend, and the only way anyone finds out is a support ticket — so
  // each failure names exactly what was missing.
  if (!event.tenantId && !appIdentifier) {
    return {
      granted: false,
      quantity: 0,
      reason: "no tenant_id on the webhook URL and no app identifier to resolve one from",
    };
  }
  if (!identity) return { granted: false, quantity: 0, reason: "no buyer identity on the event" };
  if (!sku && !productId && !storeProductId) {
    return { granted: false, quantity: 0, reason: "no sku or product id on the event" };
  }
  if (!stableTxnId) {
    // Without a stable id there is no safe idempotency key, and granting under a random one would
    // credit the pack again on every redelivery. Refusing is the conservative failure.
    return { granted: false, quantity: 0, reason: "no stable transaction id on the event" };
  }

  // The catalogue decides the amount — never the payload.
  // Same resolver every inbound lane uses — path → app_identifier → sole provider tenant →
  // self-hosted. This used to be an ad-hoc tenants lookup written only for this path, which is
  // exactly the duplication that left the store SUBSCRIPTION lanes with no attribution at all.
  let tenantId = event.tenantId ?? null;
  if (!tenantId) {
    try {
      const resolved = await resolveInboundTenant({
        tenantIdFromPath: event.tenantId,
        appIdentifier,
        provider,
      });
      tenantId = resolved.tenantId;
    } catch (e) {
      // Ambiguous attribution. Refused, never guessed — crediting the wrong app's ledger is worse
      // than failing a webhook the provider will redeliver.
      return { granted: false, quantity: 0, reason: (e as Error).message };
    }
  }
  if (!tenantId) {
    return {
      granted: false,
      quantity: 0,
      reason: `could not attribute this ${provider} purchase to an app — set tenants.app_identifier with tenant_app_identifier_set`,
    };
  }

  let lookup = supabaseAdmin
    .from("tenant_products")
    .select("tenant_id, sku, type, grant_quantity")
    .eq("tenant_id", tenantId);
  if (storeProductId) {
    const column = provider === "app_store" ? "app_store_product_id" : "play_product_id";
    lookup = lookup.eq(column, storeProductId);
  } else if (sku) {
    lookup = lookup.eq("sku", sku);
  } else {
    lookup = lookup.eq("id", productId);
  }
  const { data: product, error: productError } = await lookup.maybeSingle();
  const label = sku ?? storeProductId ?? productId;

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
    {
      p_kind: identity.kind,
      p_provider: identity.provider ?? null,
      p_value: identity.value,
      // A store account id is attested by the store, unlike an email typed into a checkout form.
      p_verified: identity.kind === "auth_user" || identity.kind === "oauth",
    },
  );
  if (subjectError || !subjectId) {
    return {
      granted: false,
      quantity: 0,
      reason: `could not resolve a subject for ${identity.kind}:${identity.value}: ${subjectError?.message ?? "no id returned"}`,
    };
  }

  // Key on the provider AND its transaction id. Two providers could theoretically mint the same
  // opaque id, and the ledger's uniqueness is per tenant — so the provider prefix is what keeps
  // one provider's retry from absorbing another provider's genuine purchase.
  const idempotencyKey = `${provider}:${stableTxnId}`;

  const { data: balance, error: grantError } = await supabaseAdmin.rpc("entitlement_balance_grant", {
    p_tenant_id: product.tenant_id,
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
