// supabase/functions/_shared/__tests__/consumable-handler.test.ts
//
// The provider-agnostic consumable grant. Every assertion here is about a buyer who HAS ALREADY
// BEEN CHARGED, which is what makes the refusal paths matter more than the happy one: a grant that
// quietly does nothing is money taken for goods never delivered, and the only detector is a
// support ticket.
//
// The two properties worth protecting:
//
//   1. the AMOUNT comes from the catalogue, never the webhook payload — a provider-supplied
//      quantity would let a stale or forged number into the ledger;
//   2. every refusal is NAMED, so an operator reading logs learns which purchase failed and why,
//      rather than seeing silence.
//
// Strategy mirrors subscription-handler.audit.test.ts: stub fetch, assert on the RPC traffic.
//
// Run:  deno test --allow-env --allow-net supabase/functions/_shared/__tests__/consumable-handler.test.ts

Deno.env.set("SUPABASE_URL", "http://stub.local");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "stub-service-role-key");

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";

// DYNAMIC import: supabase-admin.ts builds its client at module top level, and static imports are
// hoisted above the Deno.env.set calls above. Same reason subscription-handler.audit.test.ts does it.
const { handleConsumablePurchase } = await import("../consumable-handler.ts");

interface Captured {
  url: string;
  body: Record<string, unknown> | null;
}

const TENANT = "ba973ad0-8788-4c0f-89c8-1ff9533fa79f";
const SUBJECT = "11111111-2222-3333-4444-555555555555";

/**
 * @param product the tenant_products row the catalogue lookup returns (null = not found)
 */
function stubFetch(product: Record<string, unknown> | null, opts: { grantBalance?: number } = {}) {
  const calls: Captured[] = [];
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
    const u = String(url);
    let body: Record<string, unknown> | null = null;
    try {
      body = init?.body ? JSON.parse(String(init.body)) : null;
    } catch {
      body = null;
    }
    calls.push({ url: u, body });

    if (u.includes("/rest/v1/tenant_products")) {
      return Promise.resolve(
        new Response(JSON.stringify(product), { status: 200, headers: { "content-type": "application/json" } }),
      );
    }
    if (u.includes("entitlement_subject_resolve")) {
      return Promise.resolve(
        new Response(JSON.stringify(SUBJECT), { status: 200, headers: { "content-type": "application/json" } }),
      );
    }
    if (u.includes("entitlement_balance_grant")) {
      return Promise.resolve(
        new Response(JSON.stringify(opts.grantBalance ?? 550), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    return Promise.resolve(new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
  }) as typeof fetch;
  return calls;
}

const baseEvent = {
  tenantId: TENANT,
  email: "buyer@example.com",
  sku: "cappy_ripples_550",
  stableTxnId: "pi_123",
  provider: "stripe",
};

Deno.test("grants the CATALOGUE quantity, not anything from the payload", async () => {
  const calls = stubFetch({ sku: "cappy_ripples_550", type: "consumable", grant_quantity: 550 });

  const res = await handleConsumablePurchase(baseEvent);

  assertEquals(res.granted, true);
  assertEquals(res.quantity, 550);
  const grant = calls.find((c) => c.url.includes("entitlement_balance_grant"));
  assert(grant, "expected a grant RPC call");
  assertEquals(grant!.body?.p_quantity, 550);
  assertEquals(grant!.body?.p_sku, "cappy_ripples_550");
  assertEquals(grant!.body?.p_subject_id, SUBJECT);
});

Deno.test("keys idempotency on provider + transaction id so a redelivery cannot double-grant", async () => {
  const calls = stubFetch({ sku: "cappy_ripples_550", type: "consumable", grant_quantity: 550 });

  await handleConsumablePurchase(baseEvent);

  const grant = calls.find((c) => c.url.includes("entitlement_balance_grant"));
  // Provider-prefixed: two providers can mint the same opaque id, and the ledger's uniqueness is
  // per tenant — without the prefix one provider's retry could absorb another's real purchase.
  assertEquals(grant!.body?.p_idempotency_key, "stripe:pi_123");
  assertEquals(grant!.body?.p_stable_txn_id, "pi_123");
});

Deno.test("refuses a sku whose grant_quantity is zero, and says the buyer was charged", async () => {
  const calls = stubFetch({ sku: "broken_pack", type: "consumable", grant_quantity: 0 });

  const res = await handleConsumablePurchase({ ...baseEvent, sku: "broken_pack" });

  assertEquals(res.granted, false);
  assertEquals(res.quantity, 0);
  assert(res.reason!.includes("would receive nothing"), `unhelpful reason: ${res.reason}`);
  // Crucially: no grant attempted. Granting 0 would report success for a no-op.
  assert(!calls.some((c) => c.url.includes("entitlement_balance_grant")));
});

Deno.test("refuses a subscription routed here by mistake", async () => {
  const calls = stubFetch({ sku: "cappy_plus_annual", type: "subscription", grant_quantity: 0 });

  const res = await handleConsumablePurchase({ ...baseEvent, sku: "cappy_plus_annual" });

  assertEquals(res.granted, false);
  assert(res.reason!.includes("not a consumable"));
  assert(!calls.some((c) => c.url.includes("entitlement_balance_grant")));
});

Deno.test("refuses a sku that is not in the tenant's catalogue", async () => {
  stubFetch(null);

  const res = await handleConsumablePurchase({ ...baseEvent, sku: "unknown_sku" });

  assertEquals(res.granted, false);
  assert(res.reason!.includes("not in this tenant's catalogue"));
});

Deno.test("refuses without a stable transaction id rather than inventing a key", async () => {
  const calls = stubFetch({ sku: "cappy_ripples_550", type: "consumable", grant_quantity: 550 });

  const res = await handleConsumablePurchase({ ...baseEvent, stableTxnId: null });

  assertEquals(res.granted, false);
  assert(res.reason!.includes("stable transaction id"));
  // A random key would make EVERY redelivery grant the pack again — strictly worse than refusing.
  assert(!calls.some((c) => c.url.includes("entitlement_balance_grant")));
});

Deno.test("refuses an unattributed grant (no tenant, no identity)", async () => {
  stubFetch({ sku: "cappy_ripples_550", type: "consumable", grant_quantity: 550 });

  const noTenant = await handleConsumablePurchase({ ...baseEvent, tenantId: null });
  assertEquals(noTenant.granted, false);
  assert(noTenant.reason!.includes("tenant"));

  const noIdentity = await handleConsumablePurchase({ ...baseEvent, email: null });
  assertEquals(noIdentity.granted, false);
  assert(noIdentity.reason!.includes("identity"));
});


// ── Store lanes ────────────────────────────────────────────────────────────────────────────────
//
// Play's Pub/Sub topic and Apple's ASSN endpoint are per-DEPLOYMENT, not per-tenant, so neither
// can pass a tenantId — `entitlement-reconcile` records `tenantId: null` for both. The catalogue
// row that owns the STORE product id is what supplies it, which is only possible because the
// product sync writes play_product_id / app_store_product_id back after creating the product.

/** Store lookups resolve by store id and must return tenant_id, since the webhook has none. */
function stubStoreFetch(
  product: Record<string, unknown> | null,
  opts: { tenant?: Record<string, unknown> | null; providerTenants?: Array<{ tenant_id: string }> } = {},
) {
  const calls: Captured[] = [];
  globalThis.fetch = ((url: string | URL, init?: RequestInit) => {
    const u = String(url);
    let body: Record<string, unknown> | null = null;
    try {
      body = init?.body ? JSON.parse(String(init.body)) : null;
    } catch {
      body = null;
    }
    calls.push({ url: u, body });
    if (u.includes("/rest/v1/tenant_providers")) {
      // The sole-provider-tenant fallback maps over this — it must be an ARRAY.
      return Promise.resolve(
        new Response(JSON.stringify(opts.providerTenants ?? []), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }
    if (u.includes("/rest/v1/tenants")) {
      const t = opts.tenant === undefined ? { id: TENANT } : opts.tenant;
      return Promise.resolve(
        new Response(JSON.stringify(t), { status: 200, headers: { "content-type": "application/json" } }),
      );
    }
    if (u.includes("/rest/v1/tenant_products")) {
      return Promise.resolve(
        new Response(JSON.stringify(product), { status: 200, headers: { "content-type": "application/json" } }),
      );
    }
    if (u.includes("entitlement_subject_resolve")) {
      return Promise.resolve(
        new Response(JSON.stringify(SUBJECT), { status: 200, headers: { "content-type": "application/json" } }),
      );
    }
    return Promise.resolve(
      new Response(JSON.stringify(550), { status: 200, headers: { "content-type": "application/json" } }),
    );
  }) as typeof fetch;
  return calls;
}

Deno.test("Play: derives the tenant from the store product id, with no tenantId on the event", async () => {
  const calls = stubStoreFetch({
    tenant_id: TENANT,
    sku: "cappy_ripples_550",
    type: "consumable",
    grant_quantity: 550,
  });

  const res = await handleConsumablePurchase({
    tenantId: null, // Pub/Sub topic is per-deployment — there is no tenant to pass
    appIdentifier: "com.mobilebytesensei.cappy",
    storeProductId: "cappy_ripples_550",
    identity: { kind: "auth_user", value: "obfuscated-account-123" },
    stableTxnId: "purchase-token-abc",
    provider: "google_play",
  });

  assertEquals(res.granted, true);
  assertEquals(res.quantity, 550);
  // Tenant comes from the APP, then the product is looked up INSIDE that tenant.
  const tenantLookup = calls.find((c) => c.url.includes("/rest/v1/tenants"));
  assert(tenantLookup, "expected a tenants lookup by app_identifier");
  assert(tenantLookup!.url.includes("app_identifier"), tenantLookup!.url);
  const lookup = calls.find((c) => c.url.includes("tenant_products"));
  assert(lookup!.url.includes("play_product_id"), `looked up by the wrong column: ${lookup!.url}`);
  // Scoped to the resolved tenant — without this a sku shared by two tenants is ambiguous.
  assert(lookup!.url.includes("tenant_id"), `product lookup not tenant-scoped: ${lookup!.url}`);
  const grant = calls.find((c) => c.url.includes("entitlement_balance_grant"));
  assertEquals(grant!.body?.p_tenant_id, TENANT);
  assertEquals(grant!.body?.p_idempotency_key, "google_play:purchase-token-abc");
});

Deno.test("App Store: resolves on app_store_product_id, not the Play column", async () => {
  const calls = stubStoreFetch({
    tenant_id: TENANT,
    sku: "cappy_ripples_550",
    type: "consumable",
    grant_quantity: 550,
  });

  await handleConsumablePurchase({
    tenantId: null,
    appIdentifier: "com.mobilebytesensei.cappy",
    storeProductId: "com.mobilebytesensei.cappy.cappyripples550",
    identity: { kind: "auth_user", value: "app-account-token-xyz" },
    stableTxnId: "original-txn-999",
    provider: "app_store",
  });

  const lookup = calls.find((c) => c.url.includes("tenant_products"));
  assert(
    lookup!.url.includes("app_store_product_id"),
    `App Store must not resolve on the Play column: ${lookup!.url}`,
  );
});

Deno.test("a store account id is recorded as VERIFIED, unlike a typed-in email", async () => {
  const calls = stubStoreFetch({
    tenant_id: TENANT,
    sku: "cappy_ripples_550",
    type: "consumable",
    grant_quantity: 550,
  });

  await handleConsumablePurchase({
    tenantId: null,
    appIdentifier: "com.mobilebytesensei.cappy",
    storeProductId: "cappy_ripples_550",
    identity: { kind: "auth_user", value: "obfuscated-account-123" },
    stableTxnId: "purchase-token-abc",
    provider: "google_play",
  });

  const resolve = calls.find((c) => c.url.includes("entitlement_subject_resolve"));
  // The store attested this id; an email typed into a checkout form is not attested, and the
  // identity-link rules in migration 154 depend on that distinction.
  assertEquals(resolve!.body?.p_verified, true);
  assertEquals(resolve!.body?.p_kind, "auth_user");
});

Deno.test("an unknown store product is refused, not granted against another tenant", async () => {
  stubStoreFetch(null);

  const res = await handleConsumablePurchase({
    tenantId: null,
    appIdentifier: "com.mobilebytesensei.cappy",
    storeProductId: "not_in_any_catalogue",
    identity: { kind: "auth_user", value: "obfuscated-account-123" },
    stableTxnId: "purchase-token-abc",
    provider: "google_play",
  });

  assertEquals(res.granted, false);
  assert(res.reason!.includes("not in this tenant's catalogue"));
});


Deno.test("an unknown app on a MULTI-tenant deployment is refused, never attributed", async () => {
  // No tenant carries this app_identifier. With two tenants on the provider there is no safe
  // guess, and crediting whichever one happened to match would put one app's paid purchase into
  // another app's ledger — the exact failure per-tenant-app scoping exists to prevent.
  const calls = stubStoreFetch(
    { tenant_id: TENANT, sku: "x", type: "consumable", grant_quantity: 550 },
    { tenant: null, providerTenants: [{ tenant_id: TENANT }, { tenant_id: "other-tenant" }] },
  );

  const res = await handleConsumablePurchase({
    tenantId: null,
    appIdentifier: "com.someone.else",
    storeProductId: "coins_550",
    identity: { kind: "auth_user", value: "acct-1" },
    stableTxnId: "tok-1",
    provider: "google_play",
  });

  assertEquals(res.granted, false);
  assert(res.reason!.includes("Ambiguous tenant"), res.reason);
  assert(!calls.some((c) => c.url.includes("entitlement_balance_grant")));
});

Deno.test("an un-backfilled app_identifier falls back to the SOLE provider tenant", async () => {
  // Deliberate, and the same rule the web PSPs have always used: a self-hosted or single-app
  // deployment that never set app_identifier should not have paid purchases rejected. It is only
  // safe because it requires exactly one candidate — two is the ambiguous case above.
  stubStoreFetch(
    { tenant_id: TENANT, sku: "cappy_ripples_550", type: "consumable", grant_quantity: 550 },
    { tenant: null, providerTenants: [{ tenant_id: TENANT }] },
  );

  const res = await handleConsumablePurchase({
    tenantId: null,
    appIdentifier: "com.not.backfilled",
    storeProductId: "cappy_ripples_550",
    identity: { kind: "auth_user", value: "acct-1" },
    stableTxnId: "tok-2",
    provider: "google_play",
  });

  assertEquals(res.granted, true);
  assertEquals(res.quantity, 550);
});

Deno.test("a store event with no app identifier is refused", async () => {
  stubStoreFetch({ tenant_id: TENANT, sku: "x", type: "consumable", grant_quantity: 550 });

  const res = await handleConsumablePurchase({
    tenantId: null,
    storeProductId: "coins_550",
    identity: { kind: "auth_user", value: "acct-1" },
    stableTxnId: "tok-1",
    provider: "google_play",
  });

  assertEquals(res.granted, false);
  assert(res.reason!.includes("app identifier"), res.reason);
});
