/**
 * `/config` resolution, end to end against a real database and a real edge function.
 *
 * Every case below is a defect that SHIPPED and was found by hand on a device or in a dashboard —
 * never by a test. The stubbed unit suite passed throughout, because each bug lives in the meeting
 * of a real row shape with a predicate over it, and a stub supplies neither.
 *
 * Run: deno test --allow-net --allow-run --allow-env tests/e2e/
 */

import { assert, assertEquals, assertNotEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  bindingFor,
  dropTenant,
  getConfig,
  providerIds,
  psql,
  psqlRows,
  requireLocalStack,
  seedTenant,
  sqlLit,
} from "./harness.ts";

Deno.test("e2e: local stack is up", requireLocalStack);

/**
 * THE RAZORPAY-PLAN DEFECT.
 *
 * `/config`'s enabled-provider filter required at least one non-empty payment link. Razorpay turns a
 * subscription into a PLAN and issues no link, so a fully-synced Razorpay carried `{sku: {}}`, failed
 * the filter, and vanished from `providers[]` — leaving the SDK reporting `primary=stripe` on a
 * tenant whose Android routing rule says razorpay. Observed on a physical device: cappy, android,
 * country=IN, INR plan ids present on all three products.
 */
Deno.test("config: a provider with plan ids but ZERO payment links is still offered", async () => {
  const t = await seedTenant({
    name: "rzp_plans_no_links",
    products: [{
      sku: "plus-monthly",
      basePriceCents: 69900,
      baseCurrency: "INR",
      razorpayPlanIds: { INR: "plan_E2E_MONTHLY" },
      stripeProductId: "prod_E2E",
      stripePriceIds: { INR: "price_E2E_INR", USD: "price_E2E_USD" },
    }],
    providers: [
      // Exactly the shape the real tenant had: sku keys present, every currency map EMPTY.
      { provider: "razorpay", liveKeyId: "rzp_live_e2e", livePaymentLinks: { "plus-monthly": {} } },
      { provider: "stripe", liveKeyId: "pk_live_e2e", livePaymentLinks: { "plus-monthly": { INR: "https://buy.stripe.com/e2e" } } },
    ],
    routing: { android: ["razorpay"] },
    pricing: [["IN", "INR", 69900]],
  });
  try {
    const { status, body } = await getConfig(t.apiKeyLive, { platform: "android", locale: "en-IN" });
    assertEquals(status, 200, `non-200 from /config: ${JSON.stringify(body).slice(0, 300)}`);

    const ids = providerIds(body);
    assert(
      ids.includes("razorpay"),
      `razorpay must be offered — it has an INR plan id for this product. Got providers=${JSON.stringify(ids)}`,
    );
    assertEquals(
      ids[0],
      "razorpay",
      `the tenant's android routing rule names razorpay as primary; got ${JSON.stringify(ids)}`,
    );

    const b = bindingFor(body, "plus-monthly");
    assertEquals(b?.provider, "razorpay");
    assertEquals(b?.product_id, "plan_E2E_MONTHLY");
  } finally {
    await dropTenant(t.id);
  }
});

/**
 * THE DEAD-PAYWALL DEFECT (native half).
 *
 * Razorpay is INR-only. A US buyer on Android hit a chain of `[razorpay]`, matched nothing, and got
 * `store_binding: null` — no way to pay at all, while a perfectly good Play product id sat unused.
 */
Deno.test("config: android falls through to google_play when the chain cannot serve the currency", async () => {
  const t = await seedTenant({
    name: "android_native_tail",
    products: [{
      sku: "plus-monthly",
      playProductId: "plus_monthly_play",
      razorpayPlanIds: { INR: "plan_INR_ONLY" },
    }],
    providers: [
      { provider: "razorpay", liveKeyId: "rzp_live_e2e", livePaymentLinks: { "plus-monthly": {} } },
      { provider: "google_play", storeConfig: { package_name: "com.e2e.app" } },
    ],
    routing: { android: ["razorpay"] },
    // The IN price row is what makes en-IN resolve INR. Without it the locale falls back to the
    // product's base currency (USD) and razorpay is skipped for a reason this case is not about.
    pricing: [["IN", "INR", 69900]],
  });
  try {
    const inr = await getConfig(t.apiKeyLive, { platform: "android", locale: "en-IN" });
    assertEquals(
      bindingFor(inr.body, "plus-monthly")?.provider,
      "razorpay",
      "en-IN must honour the operator's chain — razorpay can serve INR",
    );

    const usd = await getConfig(t.apiKeyLive, { platform: "android", locale: "en-US" });
    const b = bindingFor(usd.body, "plus-monthly");
    assertNotEquals(b, null, "a US buyer must never be left with no provider at all");
    assertEquals(b?.provider, "google_play");
    assertEquals(b?.product_id, "plus_monthly_play");
  } finally {
    await dropTenant(t.id);
  }
});

/**
 * THE DEAD-PAYWALL DEFECT (web half) — the one the native tail did NOT cover.
 *
 * web and desktop have no native store, so when the declared chain could not serve, they resolved
 * nothing. Found only because an end-to-end probe printed `binding=(none)` for web.
 */
Deno.test("config: web and desktop fall back to a web PSP rather than resolving nothing", async () => {
  const t = await seedTenant({
    name: "web_psp_tail",
    products: [{
      sku: "plus-monthly",
      stripeProductId: "prod_E2E",
      stripePriceIds: { USD: "price_E2E_USD" },
      razorpayPlanIds: { INR: "plan_INR_ONLY" },
    }],
    providers: [
      { provider: "razorpay", liveKeyId: "rzp_live_e2e", livePaymentLinks: { "plus-monthly": {} } },
      { provider: "stripe", liveKeyId: "pk_live_e2e", livePaymentLinks: { "plus-monthly": { USD: "https://buy.stripe.com/e2e" } } },
    ],
    // The operator narrowed both to razorpay — a preference, not a request to drop the sale.
    routing: { web: ["razorpay"], desktop: ["razorpay"] },
  });
  try {
    for (const platform of ["web", "desktop"]) {
      const { body } = await getConfig(t.apiKeyLive, { platform, locale: "en-US" });
      const b = bindingFor(body, "plus-monthly");
      assertNotEquals(b, null, `${platform}/en-US resolved NO binding — a dead paywall`);
      assertEquals(b?.provider, "stripe_card", `${platform} should fall back to the web PSP`);
    }
  } finally {
    await dropTenant(t.id);
  }
});

/**
 * The tail must never STEAL from a chain that resolves. An operator who put Razorpay first and whose
 * Razorpay can serve the buyer must get Razorpay, every time.
 */
Deno.test("config: the fallback tail never overrides a chain that resolves", async () => {
  const t = await seedTenant({
    name: "tail_does_not_steal",
    products: [{
      sku: "plus-monthly",
      stripeProductId: "prod_E2E",
      stripePriceIds: { INR: "price_E2E_INR" },
      razorpayPlanIds: { INR: "plan_E2E_INR" },
      playProductId: "plus_monthly_play",
    }],
    providers: [
      { provider: "razorpay", liveKeyId: "rzp_live_e2e", livePaymentLinks: { "plus-monthly": {} } },
      { provider: "stripe", liveKeyId: "pk_live_e2e", livePaymentLinks: { "plus-monthly": { INR: "https://buy.stripe.com/e2e" } } },
      { provider: "google_play", storeConfig: { package_name: "com.e2e.app" } },
    ],
    routing: { android: ["razorpay", "stripe_card"] },
    pricing: [["IN", "INR", 69900]],
  });
  try {
    const { body } = await getConfig(t.apiKeyLive, { platform: "android", locale: "en-IN" });
    assertEquals(
      bindingFor(body, "plus-monthly")?.provider,
      "razorpay",
      "razorpay can serve INR and is first in the chain — nothing may pre-empt it",
    );
    assertEquals(providerIds(body)[0], "razorpay");
  } finally {
    await dropTenant(t.id);
  }
});

/** iOS prefers its native store when the product carries an App Store id, and falls through when not. */
Deno.test("config: ios binds app_store when the id exists, falls through when it does not", async () => {
  const withId = await seedTenant({
    name: "ios_with_appstore_id",
    products: [{
      sku: "plus-monthly",
      appStoreProductId: "com.e2e.app.plus.monthly",
      stripeProductId: "prod_E2E",
      stripePriceIds: { USD: "price_E2E_USD" },
    }],
    providers: [
      { provider: "app_store", storeConfig: { bundle_id: "com.e2e.app" } },
      { provider: "stripe", liveKeyId: "pk_live_e2e", livePaymentLinks: { "plus-monthly": { USD: "https://buy.stripe.com/e2e" } } },
    ],
    routing: { ios: ["app_store", "stripe_card"] },
  });
  const withoutId = await seedTenant({
    name: "ios_without_appstore_id",
    products: [{
      sku: "plus-monthly",
      stripeProductId: "prod_E2E",
      stripePriceIds: { USD: "price_E2E_USD" },
    }],
    providers: [
      { provider: "app_store", storeConfig: { bundle_id: "com.e2e.app" } },
      { provider: "stripe", liveKeyId: "pk_live_e2e", livePaymentLinks: { "plus-monthly": { USD: "https://buy.stripe.com/e2e" } } },
    ],
    routing: { ios: ["app_store", "stripe_card"] },
  });
  try {
    const a = await getConfig(withId.apiKeyLive, { platform: "ios", locale: "en-US" });
    assertEquals(bindingFor(a.body, "plus-monthly")?.provider, "app_store");
    assertEquals(bindingFor(a.body, "plus-monthly")?.product_id, "com.e2e.app.plus.monthly");

    const b = await getConfig(withoutId.apiKeyLive, { platform: "ios", locale: "en-US" });
    assertEquals(
      bindingFor(b.body, "plus-monthly")?.provider,
      "stripe_card",
      "no App Store id means app_store cannot bind — the chain must continue, not stop",
    );
  } finally {
    await dropTenant(withId.id);
    await dropTenant(withoutId.id);
  }
});

/** Per-currency resolution: the same product must not quote one price id to every locale. */
Deno.test("config: price ids resolve per currency, not per product", async () => {
  const t = await seedTenant({
    name: "per_currency_price",
    products: [{
      sku: "plus-monthly",
      stripeProductId: "prod_E2E",
      stripePriceIds: { USD: "price_USD_E2E", INR: "price_INR_E2E" },
    }],
    providers: [{
      provider: "stripe",
      liveKeyId: "pk_live_e2e",
      livePaymentLinks: { "plus-monthly": { USD: "https://buy.stripe.com/usd", INR: "https://buy.stripe.com/inr" } },
    }],
    routing: { web: ["stripe_card"] },
    pricing: [["US", "USD", 999], ["IN", "INR", 69900]],
  });
  try {
    const us = await getConfig(t.apiKeyLive, { platform: "web", locale: "en-US" });
    const inn = await getConfig(t.apiKeyLive, { platform: "web", locale: "en-IN" });
    const usId = bindingFor(us.body, "plus-monthly")?.product_id;
    const inId = bindingFor(inn.body, "plus-monthly")?.product_id;
    assertEquals(usId, "price_USD_E2E");
    assertEquals(inId, "price_INR_E2E");
    assertNotEquals(usId, inId, "two currencies must not resolve to the same price id");
  } finally {
    await dropTenant(t.id);
  }
});

/** A provider with neither a link nor any per-product artifact genuinely cannot serve — stay out. */
Deno.test("config: a provider with no link AND no artifact is correctly excluded", async () => {
  const t = await seedTenant({
    name: "provider_truly_empty",
    products: [{
      sku: "plus-monthly",
      stripeProductId: "prod_E2E",
      stripePriceIds: { USD: "price_E2E_USD" },
    }],
    providers: [
      { provider: "razorpay", liveKeyId: "rzp_live_e2e", livePaymentLinks: {} },
      { provider: "stripe", liveKeyId: "pk_live_e2e", livePaymentLinks: { "plus-monthly": { USD: "https://buy.stripe.com/e2e" } } },
    ],
    routing: { web: ["stripe_card"] },
  });
  try {
    const { body } = await getConfig(t.apiKeyLive, { platform: "web", locale: "en-US" });
    assert(
      !providerIds(body).includes("razorpay"),
      "razorpay has no link and no plan id here — offering it would be a dead option",
    );
  } finally {
    await dropTenant(t.id);
  }
});

/**
 * THE TTL IS A SETTING, AND IT IS THE PROPAGATION DELAY.
 *
 * The SDK is fully server-driven, so this number decides how long a dashboard change stays invisible
 * on a device — it was hardcoded to 3600, which is why every support answer began with "wait up to
 * an hour". A new tenant now defaults to 5 minutes and an operator can change it.
 */
Deno.test("config: serves the tenant's cache TTL, defaulting to 5 minutes", async () => {
  const t = await seedTenant({
    name: "ttl_default",
    products: [{ sku: "plus-monthly", stripeProductId: "prod_E2E", stripePriceIds: { USD: "price_E2E" } }],
    providers: [{ provider: "stripe", liveKeyId: "pk_live_e2e", livePaymentLinks: { "plus-monthly": { USD: "https://buy.stripe.com/e2e" } } }],
  });
  try {
    const a = await getConfig(t.apiKeyLive, { platform: "web", locale: "en-US" });
    assertEquals(a.body.cache_ttl_seconds, 300, "a new app must default to 5 minutes, not an hour");

    await psql(
      `UPDATE tenants SET config_cache_ttl_seconds = 60 WHERE id = ${sqlLit(t.id)}::uuid`,
    );
    const b = await getConfig(t.apiKeyLive, { platform: "web", locale: "en-US" });
    assertEquals(b.body.cache_ttl_seconds, 60, "the operator's choice must reach the device");
  } finally {
    await dropTenant(t.id);
  }
});

/**
 * 0 IS THE SDK'S STALE SENTINEL, NOT "never cache".
 *
 * `ConfigCache.read()` returns a copy with `cacheTtlSeconds = 0` to mean expired, and PayCraft tests
 * that field to decide staleness. A tenant who set 0 hoping for "always fresh" would make every
 * cached read look permanently expired, so the database must refuse it outright.
 */
Deno.test("config: a TTL of 0 cannot be stored", async () => {
  const t = await seedTenant({ name: "ttl_zero_forbidden" });
  try {
    let rejected = false;
    try {
      await psql(`UPDATE tenants SET config_cache_ttl_seconds = 0 WHERE id = ${sqlLit(t.id)}::uuid`);
    } catch (e) {
      rejected = String(e).includes("tenants_config_cache_ttl_seconds_range");
    }
    assert(rejected, "0 must be refused by CHECK — it is the SDK's stale sentinel");
  } finally {
    await dropTenant(t.id);
  }
});

Deno.test("config: serves the tenant's exit survey as edited, with the offer's discount and never the coupon", async () => {
  const t = await seedTenant({ name: "e2e_exit_survey", products: [{ sku: "plus-monthly" }] });
  try {
    const [[couponId]] = await psqlRows(`INSERT INTO tenant_coupons (tenant_id, code, percent_off, duration)
      VALUES (${sqlLit(t.id)}, 'E2EWINBACK50', 50, 'once') RETURNING id`);
    // the dashboard editor's write, as the database sees it: new title, cap, an offer on "too expensive", one reason off
    await psql(`UPDATE tenant_exit_survey SET title = 'Why not today?', survey_cap_days = 3,
      reasons = jsonb_build_array(
        jsonb_build_object('code','too_expensive','label','Too pricey','enabled',true,'action','offer','coupon_id',${sqlLit(couponId)}),
        jsonb_build_object('code','just_looking','label','Just looking','enabled',false,'action','none'),
        jsonb_build_object('code','other','label','Something else','enabled',true,'action','none','free_text',true))
      WHERE tenant_id = ${sqlLit(t.id)}`);
    const { status, body } = await getConfig(t.apiKeyLive);
    assertEquals(status, 200);
    const s = (body as { exit_survey: any }).exit_survey;
    assertEquals(s.enabled, true);
    assertEquals(s.title, "Why not today?");
    assertEquals(s.cap_days, 3);
    assertEquals(s.reasons.map((r: { code: string }) => r.code), ["too_expensive", "other"]);
    assertEquals(s.reasons[0].offer, { percent_off: 50, duration: "once" });
    assert(!JSON.stringify(s).includes("E2EWINBACK50") && !JSON.stringify(s).includes(couponId), "coupon code/id never served");
  } finally {
    await dropTenant(t.id);
  }
});
