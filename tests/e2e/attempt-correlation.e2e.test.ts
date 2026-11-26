/**
 * Purchase-attempt correlation end to end (paycraft-attempt-observability, migration 210): the REAL edge
 * functions against the REAL local database — the attempt an SDK names is the record every lane writes to.
 *
 * WHAT IS AND IS NOT EXERCISED HERE
 *   · checkout-initiate opens the attempt the request names and records its refusal (stage, class, code,
 *     message ≤ 200) — run for real up to the provider call. The provider call itself is NOT made: it mints
 *     a real Checkout Session / Subscription at a PSP (see checkout-initiate.e2e.test.ts). That the id rides
 *     to the PSP as Stripe `client_reference_id` + `metadata.attempt_id` and Razorpay `notes.attempt_id` is
 *     pinned on the exact request bodies by checkout-initiate/__tests__/{stripe-session,razorpay-subscription}.
 *   · Stripe and Razorpay webhooks are REPLAYED, signed with a webhook secret this test seeds for its own
 *     tenant (a fixture value, encrypted in the database exactly as a real one is), and must close the SAME
 *     attempt row as granted with correlation = exact — or failed, with the provider's code.
 *   · Google Play RTDN and App Store notifications re-fetch truth from Google / Apple, which no local stack
 *     can answer; their resolvers and the original_transaction_id / purchase-token map are unit-tested in
 *     supabase/functions/__tests__/payment-attempts.test.ts. Here the store lane's register endpoint is run
 *     for real up to the store call, proving the attempt id is accepted and a failure is recorded on it.
 *   · The paid-not-granted detector runs in SQL on an injected clock against a real attempt row.
 *
 * Every test seeds its own tenant and drops it in `finally`.
 *
 * Run: deno test --allow-net --allow-run --allow-env tests/e2e/attempt-correlation.e2e.test.ts
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dropTenant, FUNCTIONS_URL, psql, psqlRows, requireLocalStack, seedTenant, sqlLit } from "./harness.ts";

Deno.test("e2e: local stack is up", requireLocalStack);

const AID = () => "att-" + crypto.randomUUID();

/** A fixture webhook secret for THIS test's tenant — generated per run, never a real provider secret. */
const fixtureSecret = (prefix: string) => `${prefix}_e2e_${crypto.randomUUID().replaceAll("-", "")}`;

/**
 * Store [secret] as the tenant's test-mode webhook secret for [provider], encrypted with the database's own
 * passphrase — the bytes the webhook's tenant_providers_decrypt_for_webhook reads back.
 */
async function seedWebhookSecret(tenantId: string, provider: string, secret: string, secretKey: string | null): Promise<void> {
  const enc = (v: string) =>
    `extensions.pgp_sym_encrypt(${sqlLit(v)}, (SELECT passphrase FROM paycraft_secrets_config WHERE id))`;
  await psql(`
    INSERT INTO tenant_providers (tenant_id, provider, is_active, test_key_id, test_secret_key_enc, test_webhook_secret_enc)
    VALUES (${sqlLit(tenantId)}::uuid, ${sqlLit(provider)}, true, ${sqlLit(`${provider}_test_key_e2e`)},
            ${secretKey ? enc(secretKey) : "NULL"}, ${enc(secret)})`);
}

/** The attempt a checkout-initiate success would have left: opened, at the provider, keyed by its object. */
async function seedOpenedAttempt(tenantId: string, attemptId: string, provider: string, sessionId: string, email: string) {
  await psql(`
    INSERT INTO checkout_attempts (tenant_id, provider, mode, email, plan, outcome, provider_session_id, attempt_id, state)
    VALUES (${sqlLit(tenantId)}::uuid, ${sqlLit(provider)}, 'test', ${sqlLit(email)}, 'pro-lifetime', 'abandoned',
            ${sqlLit(sessionId)}, ${sqlLit(attemptId)}, 'checkout_opened')`);
}

/** Rows a webhook replay writes outside the tenant cascade. */
async function dropReplayRows(tenantId: string): Promise<void> {
  for (const t of ["subscriptions", "webhook_logs", "entitlement_records"]) {
    await psql(`DELETE FROM ${t} WHERE tenant_id = ${sqlLit(tenantId)}::uuid`);
  }
}

async function hmacHex(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** A Stripe webhook delivery: `stripe-signature: t=<unix>,v1=HMAC-SHA256(secret, "<t>.<body>")`. */
async function stripeDelivery(secret: string, type: string, object: Record<string, unknown>) {
  const t = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: `evt_e2e_${crypto.randomUUID().slice(0, 8)}`, object: "event", type, livemode: false, created: t, data: { object } });
  return { body, signature: `t=${t},v1=${await hmacHex(secret, `${t}.${body}`)}` };
}

async function attempt(attemptId: string): Promise<Record<string, string>> {
  const rows = await psqlRows(`
    SELECT state, correlation, coalesce(stage,''), coalesce(error_class,''), coalesce(error_code,''),
           coalesce(error_message,''), (granted_at IS NOT NULL)::text, (paid_at IS NOT NULL)::text, tenant_id::text
    FROM checkout_attempts WHERE attempt_id = ${sqlLit(attemptId)}`);
  assertEquals(rows.length, 1, `exactly one attempt row for ${attemptId}`);
  const [state, correlation, stage, error_class, error_code, error_message, granted, paid, tenant] = rows[0];
  return { state, correlation, stage, error_class, error_code, error_message, granted, paid, tenant };
}

async function timeline(attemptId: string): Promise<string[][]> {
  return await psqlRows(`
    SELECT event, stage, coalesce(error_class,''), coalesce(error_code,''), coalesce(error_message,'')
    FROM attempt_events WHERE attempt_id = ${sqlLit(attemptId)} ORDER BY id`);
}

Deno.test("checkout-initiate: an attempt_id opens that attempt and a refusal is recorded on it (stage, class, code, message)", async () => {
  const t = await seedTenant({ name: "attempt_ci_refusal", products: [{ sku: "pro-monthly", stripeProductId: "prod_e2e" }] });
  const attemptId = AID();
  try {
    await psql(`UPDATE tenant_products SET stripe_price_id_by_currency_test = '{"USD":"price_e2e_test"}'::jsonb
                WHERE tenant_id = ${sqlLit(t.id)}::uuid`);
    const r = await fetch(`${FUNCTIONS_URL}/checkout-initiate?apiKey=${encodeURIComponent(t.apiKeyLive)}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-paycraft-mode": "test", origin: "https://e2e.test" },
      body: JSON.stringify({
        sku: "pro-monthly", provider: "stripe", currency: "USD", attempt_id: attemptId,
        customer: { email: "E2E-Stripe@Attempt.test" }, return_url: "https://e2e.test/back",
      }),
    });
    const body = await r.json();
    assertEquals(r.status, 409, JSON.stringify(body));
    assertEquals(body.error, "stripe test credentials not configured for this tenant", "the response is what it always was");

    const a = await attempt(attemptId);
    assertEquals(a.tenant, t.id);
    assertEquals(a.state, "failed");
    assertEquals(a.correlation, "exact");
    assertEquals(a.stage, "server");
    assertEquals(a.error_class, "stripe_init");
    assertEquals(a.error_code, "credentials_missing");
    const tl = await timeline(attemptId);
    assertEquals(tl.map((e) => e[0]), ["started", "failed"]);
    assertEquals(tl[1].slice(1, 4), ["server", "stripe_init", "credentials_missing"]);
    assert(tl[1][4].length > 0 && tl[1][4].length <= 200, "a bounded message");
    const [[email]] = await psqlRows(`SELECT email FROM checkout_attempts WHERE attempt_id = ${sqlLit(attemptId)}`);
    assertEquals(email, "e2e-stripe@attempt.test");
  } finally {
    await dropTenant(t.id);
  }
});

Deno.test("checkout-initiate: an older SDK (no attempt_id) opens nothing; a malformed id is refused", async () => {
  const t = await seedTenant({ name: "attempt_ci_noid", products: [{ sku: "pro-monthly" }] });
  try {
    const r = await fetch(`${FUNCTIONS_URL}/checkout-initiate?apiKey=${encodeURIComponent(t.apiKeyLive)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: "pro-monthly", customer: { email: "e2e-noid@attempt.test" } }),
    });
    await r.body?.cancel();
    assertEquals(r.status, 409, "razorpay plan missing — the refusal an older SDK always got");
    const [[n]] = await psqlRows(`SELECT count(*) FROM checkout_attempts WHERE tenant_id = ${sqlLit(t.id)}::uuid`);
    assertEquals(n, "0", "no attempt is invented for a request that named none");

    const bad = await fetch(`${FUNCTIONS_URL}/checkout-initiate?apiKey=${encodeURIComponent(t.apiKeyLive)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sku: "pro-monthly", attempt_id: "not a valid id", customer: { email: "e2e@attempt.test" } }),
    });
    await bad.body?.cancel();
    assertEquals(bad.status, 400);
  } finally {
    await dropTenant(t.id);
  }
});

Deno.test("Stripe: a replayed checkout.session.completed with metadata.attempt_id closes that same attempt as granted (exact)", async () => {
  const t = await seedTenant({ name: "attempt_stripe_grant", products: [{ sku: "pro-lifetime", type: "lifetime", interval: null }] });
  const attemptId = AID();
  const secret = fixtureSecret("whsec");
  try {
    await seedWebhookSecret(t.id, "stripe", secret, fixtureSecret("sk_test"));
    await seedOpenedAttempt(t.id, attemptId, "stripe", "cs_test_e2e_grant", "e2e-grant@attempt.test");
    const d = await stripeDelivery(secret, "checkout.session.completed", {
      id: "cs_test_e2e_grant", object: "checkout.session", mode: "payment", payment_status: "paid", livemode: false,
      customer_email: "e2e-grant@attempt.test", payment_intent: "pi_e2e_grant", customer: null,
      client_reference_id: attemptId, metadata: { plan_id: "pro-lifetime", attempt_id: attemptId },
    });
    const r = await fetch(`${FUNCTIONS_URL}/stripe-webhook/${t.id}`, {
      method: "POST", headers: { "stripe-signature": d.signature, "content-type": "application/json" }, body: d.body,
    });
    assertEquals(r.status, 200, await r.text());

    const a = await attempt(attemptId);
    assertEquals(a.state, "granted");
    assertEquals(a.correlation, "exact");
    assertEquals(a.granted, "true");
    assertEquals(a.paid, "true");
    assertEquals((await timeline(attemptId)).map((e) => e.slice(0, 2)), [
      ["checkout_opened", "server"], ["provider_result", "provider"], ["granted", "entitlement"],
    ]);
    const [[n]] = await psqlRows(`SELECT count(*) FROM checkout_attempts WHERE tenant_id = ${sqlLit(t.id)}::uuid`);
    assertEquals(n, "1", "the webhook wrote to the attempt it was given, not a new row");
  } finally {
    await dropReplayRows(t.id);
    await dropTenant(t.id);
  }
});

Deno.test("Stripe: client_reference_id alone resolves the attempt; an expired session closes it abandoned", async () => {
  const t = await seedTenant({ name: "attempt_stripe_expired", products: [{ sku: "pro-monthly" }] });
  const attemptId = AID();
  const secret = fixtureSecret("whsec");
  try {
    await seedWebhookSecret(t.id, "stripe", secret, fixtureSecret("sk_test"));
    await seedOpenedAttempt(t.id, attemptId, "stripe", "cs_test_e2e_expired", "e2e-expired@attempt.test");
    const d = await stripeDelivery(secret, "checkout.session.expired", {
      id: "cs_test_e2e_expired", object: "checkout.session", mode: "subscription", livemode: false,
      customer_email: "e2e-expired@attempt.test", client_reference_id: attemptId, metadata: { plan_id: "pro-monthly" },
    });
    const r = await fetch(`${FUNCTIONS_URL}/stripe-webhook/${t.id}`, {
      method: "POST", headers: { "stripe-signature": d.signature }, body: d.body,
    });
    assertEquals(r.status, 200, await r.text());
    const a = await attempt(attemptId);
    assertEquals(a.state, "abandoned");
    assertEquals(a.stage, "provider");
    assertEquals(a.error_class, "stripe_abandoned");
    const [[listed]] = await psqlRows(`SELECT status FROM tenant_customers_view WHERE tenant_id = ${sqlLit(t.id)}::uuid AND source = 'attempt'`);
    assertEquals(listed, "abandoned", "the merchant's customer list still shows who tried");
  } finally {
    await dropTenant(t.id);
  }
});

Deno.test("Razorpay: notes.attempt_id — activation closes the same attempt granted; a failed payment closes it failed with Razorpay's code", async () => {
  const t = await seedTenant({ name: "attempt_rzp", products: [{ sku: "pro-monthly" }] });
  const granted = AID();
  const failed = AID();
  const secret = fixtureSecret("rzp_whsec");
  try {
    await seedWebhookSecret(t.id, "razorpay", secret, null);
    await seedOpenedAttempt(t.id, granted, "razorpay", "sub_e2e_grant", "e2e-rzp@attempt.test");
    await seedOpenedAttempt(t.id, failed, "razorpay", "sub_e2e_fail", "e2e-rzp-fail@attempt.test");
    const now = Math.floor(Date.now() / 1000);
    const notes = (aid: string, email: string) => ({
      paycraft_tenant_id: t.id, paycraft_product_id: "p", paycraft_plan: "pro-monthly", paycraft_email: email,
      paycraft_mode: "test", attempt_id: aid,
    });
    const send = async (payload: Record<string, unknown>) => {
      const body = JSON.stringify(payload);
      const r = await fetch(`${FUNCTIONS_URL}/razorpay-webhook/${t.id}`, {
        method: "POST", headers: { "x-razorpay-signature": await hmacHex(secret, body), "content-type": "application/json" }, body,
      });
      return { status: r.status, text: await r.text() };
    };

    const activated = await send({
      entity: "event", account_id: "acc_e2e", event: "subscription.activated", contains: ["subscription"], created_at: now,
      payload: { subscription: { entity: {
        id: "sub_e2e_grant", plan_id: "plan_e2e", customer_id: null, status: "active", created_at: now - 60,
        current_start: now, current_end: now + 30 * 86_400, start_at: null, ended_at: null,
        notes: notes(granted, "e2e-rzp@attempt.test"),
      } } },
    });
    assertEquals(activated.status, 200, activated.text);
    const g = await attempt(granted);
    assertEquals(g.state, "granted");
    assertEquals(g.correlation, "exact");
    assertEquals(g.granted, "true");

    const declined = await send({
      entity: "event", account_id: "acc_e2e", event: "payment.failed", contains: ["payment"], created_at: now,
      payload: { payment: { entity: {
        id: "pay_e2e_fail", email: "e2e-rzp-fail@attempt.test", error_code: "BAD_REQUEST_ERROR",
        error_description: "Payment failed for e2e-rzp-fail@attempt.test — card declined by the issuer",
        notes: notes(failed, "e2e-rzp-fail@attempt.test"),
      } } },
    });
    assertEquals(declined.status, 200, declined.text);
    const f = await attempt(failed);
    assertEquals(f.state, "failed");
    assertEquals(f.stage, "provider");
    assertEquals(f.error_class, "razorpay_payment_failed");
    assertEquals(f.error_code, "bad_request_error");
    assert(!f.error_message.includes("@"), `no email in a stored failure: ${f.error_message}`);
    assert(f.error_message.length <= 200);
  } finally {
    await dropReplayRows(t.id);
    await dropTenant(t.id);
  }
});

Deno.test("events: attempt_id is stamped on the funnel row and a reported failure lands on that attempt's timeline", async () => {
  const t = await seedTenant({ name: "attempt_events" });
  const attemptId = AID();
  try {
    const post = (body: Record<string, unknown>) =>
      fetch(`${FUNCTIONS_URL}/events?apiKey=${encodeURIComponent(t.apiKeyLive)}`, {
        method: "POST", headers: { "content-type": "application/json", "x-paycraft-mode": "test" }, body: JSON.stringify(body),
      });
    const at = Date.now();
    const r = await post({
      apiKey: t.apiKeyLive, deviceRef: "dev-attempt", attempt_id: attemptId,
      events: [
        { name: "paycraft_plan_select", step: "plan", platform: "android", sku: "pro-monthly", at },
        { name: "paycraft_purchase_fail", step: "checkout", platform: "android", sku: "pro-monthly", at: at + 1,
          failure: { stage: "provider", error_class: "play_billing", error_code: "connect_6",
                     error_message: "BillingClient error for buyer someone@example.test" } },
      ],
    });
    assertEquals(r.status, 202, await r.text());
    const funnel = await psqlRows(`SELECT name, attempt_id FROM paywall_events WHERE tenant_id = ${sqlLit(t.id)}::uuid ORDER BY id`);
    assertEquals(funnel.map((x) => x[1]), [attemptId, attemptId]);
    const tl = await timeline(attemptId);
    assertEquals(tl.map((e) => e.slice(0, 4)), [
      ["paycraft_plan_select", "sdk", "", ""],
      ["paycraft_purchase_fail", "provider", "play_billing", "connect_6"],
    ]);
    assertEquals(tl[1][4], "BillingClient error for buyer [email]");

    const bad = await post({ apiKey: t.apiKeyLive, events: [{ name: "paycraft_plan_select", step: "plan", platform: "android", at, attempt_id: "has spaces" }] });
    assertEquals(bad.status, 400);
    await bad.body?.cancel();
    const noStage = await post({ apiKey: t.apiKeyLive, attempt_id: attemptId, events: [{ name: "paycraft_purchase_fail", step: "checkout", platform: "android", at, failure: { error_class: "x" } }] });
    assertEquals(noStage.status, 400, "a failure without a known stage is refused, not stored ungroupable");
    await noStage.body?.cancel();
  } finally {
    await dropTenant(t.id);
  }
});

Deno.test("register-play-purchase: the attempt_id is accepted and a failure before Play answers lands on its timeline", async () => {
  const pkg = `com.e2e.attempt.p${crypto.randomUUID().slice(0, 8)}`;
  const t = await seedTenant({ name: "attempt_play" });
  const attemptId = AID();
  try {
    await psql(`UPDATE tenants SET app_identifier = ${sqlLit(pkg)} WHERE id = ${sqlLit(t.id)}::uuid`);
    const bad = await fetch(`${FUNCTIONS_URL}/register-play-purchase`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ purchase_token: "tok", app_user_id: "u", package_name: pkg, attempt_id: "bad id" }),
    });
    assertEquals(bad.status, 400);
    await bad.body?.cancel();

    // This tenant has no Play service account, so the authoritative re-fetch cannot happen — a real failure.
    const r = await fetch(`${FUNCTIONS_URL}/register-play-purchase`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ purchase_token: `tok-${attemptId}`, product_id: "premium_monthly", app_user_id: "device-e2e", package_name: pkg, attempt_id: attemptId }),
    });
    assertEquals(r.status, 500, "the HTTP answer is what it always was");
    await r.body?.cancel();
    const tl = await psqlRows(`SELECT event, stage, error_class, error_code, tenant_id::text FROM attempt_events WHERE attempt_id = ${sqlLit(attemptId)}`);
    assertEquals(tl.length, 1);
    assertEquals(tl[0], ["failure", "server", "register_play", "processing_error", t.id]);
  } finally {
    await dropTenant(t.id);
  }
});

Deno.test("paid_not_granted: a provider-paid attempt with no grant flips at the 10-minute cutoff on the injected clock", async () => {
  const t = await seedTenant({ name: "attempt_png" });
  const attemptId = AID();
  try {
    await psql(`
      INSERT INTO checkout_attempts (tenant_id, provider, mode, app_user_id, outcome, provider_session_id, attempt_id, state, paid_at)
      VALUES (${sqlLit(t.id)}::uuid, 'google_play', 'live', 'device-png', 'abandoned', ${sqlLit(attemptId)},
              ${sqlLit(attemptId)}, 'started', NULL)`);
    await psql(`UPDATE checkout_attempts SET state = 'provider_result', paid_at = '2026-11-25T00:00:00Z'
                WHERE attempt_id = ${sqlLit(attemptId)}`);
    await psql(`SELECT attempt_stitch_run('2026-11-25T00:09:00Z'::timestamptz, 10, 120)`);
    assertEquals((await attempt(attemptId)).state, "provider_result", "not before the cutoff");
    await psql(`SELECT attempt_stitch_run('2026-11-25T00:10:01Z'::timestamptz, 10, 120)`);
    const a = await attempt(attemptId);
    assertEquals(a.state, "paid_not_granted");
    assertEquals(a.stage, "entitlement");
    assertEquals(a.error_class, "paid_not_granted");
    const tl = await timeline(attemptId);
    assertEquals(tl.at(-1)?.slice(0, 3), ["paid_not_granted", "entitlement", "paid_not_granted"]);
    // …and a late grant still settles it.
    await psql(`UPDATE checkout_attempts SET state = 'granted', granted_at = now(), closed_at = now() WHERE attempt_id = ${sqlLit(attemptId)}`);
    assertEquals((await attempt(attemptId)).state, "granted");
  } finally {
    await dropTenant(t.id);
  }
});

/**
 * attempt-stitch moves the clock the timeouts are measured on (`?now=`), so it must answer only the service
 * role (its pg_cron job). A caller without that key — here, none at all — is refused before any attempt
 * changes. The stitch logic itself is unit-tested (attempt-stitch.test.ts) and its SQL engine is asserted
 * on a real row above.
 */
Deno.test("attempt-stitch: refuses a caller that is not the service role, and nothing moves", async () => {
  const t = await seedTenant({ name: "attempt_stitch_refusal" });
  const attemptId = AID();
  try {
    await psql(`
      INSERT INTO checkout_attempts (tenant_id, provider, mode, email, outcome, provider_session_id, attempt_id, state)
      VALUES (${sqlLit(t.id)}::uuid, 'stripe', 'live', 'e2e-stitch@attempt.test', 'abandoned', 'cs_e2e_stitch',
              ${sqlLit(attemptId)}, 'checkout_opened')`);
    const r = await fetch(`${FUNCTIONS_URL}/attempt-stitch?now=2099-01-01T00:00:00Z`, { method: "POST" });
    await r.body?.cancel();
    assertEquals(r.status, 401);
    assertEquals((await attempt(attemptId)).state, "checkout_opened", "a far-future clock from an outsider abandons nothing");
  } finally {
    await dropTenant(t.id);
  }
});
