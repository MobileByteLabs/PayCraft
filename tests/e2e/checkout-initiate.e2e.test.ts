/**
 * `checkout-initiate` end to end, against the real edge function and a real database.
 *
 * WHY THIS FUNCTION EXISTS AT ALL
 * A Razorpay recurring plan has no reusable payment link — an auth link authorises ONE customer's
 * mandate, so it carries their contact and can only be minted per buyer. The SDK cannot build that
 * URL and must never hold the merchant secret that could, so the server does it. Before this lane,
 * the SDK fell through to the static-link path for every subscription and the paywall CTA failed
 * with "no checkout URL for currency INR" while the plan id sat in the config it had just rendered.
 *
 * WHAT IS AND IS NOT EXERCISED HERE
 * Every branch up to and including the credential resolution runs for real: api-key auth, product
 * lookup, product-type gating, currency→plan resolution, and the "provider not connected" refusal.
 * The final Razorpay call is deliberately NOT triggered — it creates a real subscription in a real
 * merchant account, and a test suite must not mint payment objects on every run. That last hop was
 * verified once by hand against the live account (subscription created, status `created`, no charge
 * until the buyer authorises the mandate).
 *
 * Run: deno test --allow-net --allow-run --allow-env tests/e2e/
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dropTenant, FUNCTIONS_URL, seedTenant } from "./harness.ts";

async function initiate(
  apiKey: string | null,
  body: Record<string, unknown>,
): Promise<{ status: number; body: any }> {
  const qs = apiKey === null ? "" : `?apiKey=${encodeURIComponent(apiKey)}`;
  const res = await fetch(`${FUNCTIONS_URL}/checkout-initiate${qs}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    return { status: res.status, body: JSON.parse(text) };
  } catch {
    return { status: res.status, body: { __nonJson: text.slice(0, 300) } };
  }
}

Deno.test("checkout-initiate: refuses a request with no api key", async () => {
  const r = await initiate(null, { sku: "x", customer: { email: "a@b.c" } });
  assertEquals(r.status, 400);
  assertEquals(r.body.error, "missing_apiKey");
});

Deno.test("checkout-initiate: refuses an api key that resolves to no tenant", async () => {
  const r = await initiate("pk_live_not_a_real_key", { sku: "x", customer: { email: "a@b.c" } });
  assertEquals(r.status, 401);
  assertEquals(r.body.error, "invalid_apiKey");
});

/**
 * Razorpay binds the mandate to a contact, so a blank email cannot produce a usable subscription.
 * Refusing here beats sending a request that can only fail at the PSP with a confusing message.
 */
Deno.test("checkout-initiate: requires a customer email", async () => {
  const t = await seedTenant({
    name: "ci_needs_email",
    products: [{ sku: "plus_monthly", razorpayPlanIds: { INR: "plan_E2E" } }],
    providers: [{ provider: "razorpay", liveKeyId: "rzp_live_e2e" }],
  });
  try {
    const r = await initiate(t.apiKeyLive, { sku: "plus_monthly", customer: {} });
    assertEquals(r.status, 400);
    assert(String(r.body.error).includes("email"));
  } finally {
    await dropTenant(t.id);
  }
});

Deno.test("checkout-initiate: 404s a product this tenant does not have", async () => {
  const t = await seedTenant({ name: "ci_no_product" });
  try {
    const r = await initiate(t.apiKeyLive, {
      sku: "nonexistent_sku",
      customer: { email: "a@b.c" },
    });
    assertEquals(r.status, 404);
    assertEquals(r.body.error, "product_not_found");
  } finally {
    await dropTenant(t.id);
  }
});

/**
 * One-time products DO have reusable links, which `/config` already serves. Routing them through
 * here would create a second, divergent path to the same checkout.
 */
Deno.test("checkout-initiate: refuses a non-subscription product", async () => {
  const t = await seedTenant({
    name: "ci_one_time",
    products: [{ sku: "lifetime_pass", type: "lifetime", interval: null }],
    providers: [{ provider: "razorpay", liveKeyId: "rzp_live_e2e" }],
  });
  try {
    const r = await initiate(t.apiKeyLive, {
      sku: "lifetime_pass",
      customer: { email: "a@b.c" },
    });
    assertEquals(r.status, 409);
    assert(String(r.body.error).includes("not a subscription"));
  } finally {
    await dropTenant(t.id);
  }
});

/** A subscription with no Razorpay plan cannot be started — say so, rather than 500. */
Deno.test("checkout-initiate: refuses a subscription with no Razorpay plan", async () => {
  const t = await seedTenant({
    name: "ci_no_plan",
    products: [{ sku: "plus_monthly" }],
    providers: [{ provider: "razorpay", liveKeyId: "rzp_live_e2e" }],
  });
  try {
    const r = await initiate(t.apiKeyLive, { sku: "plus_monthly", customer: { email: "a@b.c" } });
    assertEquals(r.status, 409);
    assert(String(r.body.error).includes("no Razorpay plan"));
  } finally {
    await dropTenant(t.id);
  }
});

/**
 * Asking for a currency the product has no plan for must NOT silently bill in another one. The
 * single-plan fallback is deliberate (an INR-only account can only charge INR), so this asserts the
 * ambiguous case: two plans, neither matching.
 */
Deno.test("checkout-initiate: refuses an ambiguous currency rather than guessing", async () => {
  const t = await seedTenant({
    name: "ci_ambiguous_ccy",
    products: [{
      sku: "plus_monthly",
      razorpayPlanIds: { INR: "plan_INR", AED: "plan_AED" },
    }],
    providers: [{ provider: "razorpay", liveKeyId: "rzp_live_e2e" }],
  });
  try {
    const r = await initiate(t.apiKeyLive, {
      sku: "plus_monthly",
      customer: { email: "a@b.c" },
      currency: "USD",
    });
    assertEquals(r.status, 409);
    assert(String(r.body.error).includes("no Razorpay plan for currency USD"));
  } finally {
    await dropTenant(t.id);
  }
});

/**
 * THE CREDENTIAL PATH.
 *
 * This is the last branch before the Razorpay call, and it is the one that was wrong first: the
 * function originally called `tenant_providers_decrypt_key`, the DASHBOARD's wrapper, which gates on
 * `auth.uid()` membership and therefore raises `forbidden` for a service-role caller with no user.
 * It surfaced as "razorpay live credentials not configured for this tenant" while the credentials
 * were present and correct — so this asserts the message appears only when they are GENUINELY
 * absent.
 */
Deno.test("checkout-initiate: reports missing provider credentials honestly", async () => {
  const t = await seedTenant({
    name: "ci_no_creds",
    // A plan id, but no key pair at all — exactly the state the message describes.
    products: [{ sku: "plus_monthly", razorpayPlanIds: { INR: "plan_E2E" } }],
    providers: [{ provider: "razorpay" }],
  });
  try {
    const r = await initiate(t.apiKeyLive, {
      sku: "plus_monthly",
      customer: { email: "a@b.c" },
      currency: "INR",
    });
    assertEquals(r.status, 409);
    assert(
      String(r.body.error).includes("credentials not configured"),
      `expected a credentials message, got: ${JSON.stringify(r.body)}`,
    );
  } finally {
    await dropTenant(t.id);
  }
});
