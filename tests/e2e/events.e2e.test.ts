/**
 * `events` end to end, against the real edge function and a real database (paycraft-paywall-analytics AC-5).
 *
 * The ingest is the only door into `paywall_events`, so these are the guarantees the dashboard funnel rests on:
 * a batch lands with the country the SERVER resolved (never the client's), personal data never lands, an
 * unknown event name or an oversized batch is refused whole, a bogus key is refused, and one device cannot
 * flood the table.
 *
 * Run: deno test --allow-net --allow-run --allow-env tests/e2e/events.e2e.test.ts
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dropTenant, FUNCTIONS_URL, psql, psqlRows, seedTenant, sqlLit } from "./harness.ts";

async function send(
  apiKey: string,
  body: Record<string, unknown>,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${FUNCTIONS_URL}/events?apiKey=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-paycraft-platform": "android", "x-paycraft-mode": "test", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: { raw: text.slice(0, 200) } }; }
}

const ev = (name: string, step: string, extra: Record<string, unknown> = {}) =>
  ({ name, step, platform: "android", sku: "pro-monthly", currency: "INR", at: Date.now(), ...extra });

Deno.test("events: a batch is stored with the country the server resolved", async () => {
  const t = await seedTenant({ name: "e2e_events_store" });
  try {
    const r = await send(t.apiKeyLive, {
      apiKey: t.apiKeyLive, deviceRef: "dev-e2e",
      events: [ev("paycraft_paywall_view", "paywall", { country: "US" }), ev("paycraft_checkout_start", "checkout", { provider: "razorpay" })],
    }, { "cf-ipcountry": "IN" });
    assertEquals(r.status, 202, JSON.stringify(r.body));
    assertEquals(r.body.stored, 2);
    const rows = await psqlRows(`SELECT name, country, device_ref, mode FROM paywall_events WHERE tenant_id = ${sqlLit(t.id)} ORDER BY id`);
    assertEquals(rows.map((x) => x[0]), ["paycraft_paywall_view", "paycraft_checkout_start"]);
    assertEquals(rows.map((x) => x[1]), ["IN", "IN"], "client-sent country is ignored");
    assertEquals(rows[0][2], "dev-e2e");
    assertEquals(rows[0][3], "test");
  } finally { await dropTenant(t.id); }
});

Deno.test("events: the buyer is a hash, never the email", async () => {
  const t = await seedTenant({ name: "e2e_events_userref" });
  try {
    await psql(`INSERT INTO registered_devices (email, device_token, platform, mode, is_active, tenant_id)
                VALUES ('buyer@e2e.test', 'srv_e2e_events', 'android', 'test', true, ${sqlLit(t.id)})`);
    const r = await send(t.apiKeyLive, { apiKey: t.apiKeyLive, deviceRef: "dev-1", deviceToken: "srv_e2e_events", events: [ev("paycraft_paywall_view", "paywall")] });
    assertEquals(r.status, 202, JSON.stringify(r.body));
    const [[ref]] = await psqlRows(`SELECT user_ref FROM paywall_events WHERE tenant_id = ${sqlLit(t.id)}`);
    assert(/^[0-9a-f]{64}$/.test(ref), `user_ref is a sha256 hex, got ${ref}`);
    assert(!ref.includes("buyer"));
  } finally {
    await psql(`DELETE FROM registered_devices WHERE device_token = 'srv_e2e_events'`);
    await dropTenant(t.id);
  }
});

Deno.test("events: an unknown event name refuses the whole batch", async () => {
  const t = await seedTenant({ name: "e2e_events_unknown" });
  try {
    const r = await send(t.apiKeyLive, { apiKey: t.apiKeyLive, deviceRef: "d", events: [ev("paycraft_paywall_view", "paywall"), ev("paycraft_made_up", "paywall")] });
    assertEquals(r.status, 400);
    assertEquals(r.body.error, "unknown_event");
    assertEquals(await psql(`SELECT count(*) FROM paywall_events WHERE tenant_id = ${sqlLit(t.id)}`), "0");
  } finally { await dropTenant(t.id); }
});

Deno.test("events: an oversized body is refused", async () => {
  const t = await seedTenant({ name: "e2e_events_big" });
  try {
    const big = Array.from({ length: 400 }, () => ev("paycraft_paywall_view", "paywall", { trigger: "x".repeat(90) }));
    const r = await send(t.apiKeyLive, { apiKey: t.apiKeyLive, deviceRef: "d", events: big });
    assertEquals(r.status, 413);
  } finally { await dropTenant(t.id); }
});

Deno.test("events: a bogus api key is refused", async () => {
  const r = await send("pk_e2e_does_not_exist", { apiKey: "pk_e2e_does_not_exist", deviceRef: "d", events: [ev("paycraft_paywall_view", "paywall")] });
  assertEquals(r.status, 401);
});

Deno.test("events: one device is rate limited", async () => {
  const t = await seedTenant({ name: "e2e_events_rate" });
  try {
    let limited = false;
    for (let i = 0; i < 70 && !limited; i++) {
      const r = await send(t.apiKeyLive, { apiKey: t.apiKeyLive, deviceRef: "dev-flood", events: [ev("paycraft_paywall_view", "paywall")] });
      if (r.status === 429) limited = true;
    }
    assert(limited, "expected a 429 within 70 requests from one device");
  } finally { await dropTenant(t.id); }
});
