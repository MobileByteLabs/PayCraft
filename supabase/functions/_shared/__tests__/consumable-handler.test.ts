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

Deno.test("refuses an unattributed grant (no tenant, no email)", async () => {
  stubFetch({ sku: "cappy_ripples_550", type: "consumable", grant_quantity: 550 });

  const noTenant = await handleConsumablePurchase({ ...baseEvent, tenantId: null });
  assertEquals(noTenant.granted, false);
  assert(noTenant.reason!.includes("tenant"));

  const noEmail = await handleConsumablePurchase({ ...baseEvent, email: null });
  assertEquals(noEmail.granted, false);
  assert(noEmail.reason!.includes("email"));
});
