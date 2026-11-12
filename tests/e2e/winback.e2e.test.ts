/**
 * `winback` end to end, against the real edge function and a real database (paycraft-paywall-analytics AC-9).
 *
 * A buyer who leaves answers the exit survey; this function records the answer and decides what they get:
 * the reason's offer (once per buyer, expiring), its message, or nothing. Then `checkout-initiate`, handed the
 * offer, validates it is this buyer's and live before it would put the discount on the checkout — up to the
 * provider call, which needs real merchant credentials and is not made here.
 *
 * Run: deno test --allow-net --allow-run --allow-env tests/e2e/winback.e2e.test.ts
 */

import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { dropTenant, FUNCTIONS_URL, psql, psqlRows, seedTenant, sqlLit } from "./harness.ts";

async function answer(apiKey: string, body: Record<string, unknown>): Promise<{ status: number; body: any }> {
  const res = await fetch(`${FUNCTIONS_URL}/winback?apiKey=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-paycraft-mode": "test", "cf-ipcountry": "IN" },
    body: JSON.stringify({ apiKey, platform: "android", step: "checkout", sku: "plus-monthly", ...body }),
  });
  const text = await res.text();
  try { return { status: res.status, body: JSON.parse(text) }; } catch { return { status: res.status, body: { raw: text.slice(0, 200) } }; }
}

async function seedWithOffer(name: string) {
  const t = await seedTenant({ name, products: [{ sku: "plus-monthly" }] });
  const [[couponId]] = await psqlRows(`INSERT INTO tenant_coupons (tenant_id, code, percent_off, duration, stripe_promotion_code_id, razorpay_offer_id)
    VALUES (${sqlLit(t.id)}, 'E2EWB50', 50, 'once', 'promo_e2e', 'offer_rzp_e2e') RETURNING id`);
  await psql(`UPDATE tenant_exit_survey SET reasons = jsonb_build_array(
      jsonb_build_object('code','too_expensive','label','Too pricey','enabled',true,'action','offer','coupon_id',${sqlLit(couponId)}),
      jsonb_build_object('code','payment_method','label','No UPI','enabled',true,'action','message','message','UPI works on our website.'),
      jsonb_build_object('code','just_looking','label','Just looking','enabled',true,'action','none'),
      jsonb_build_object('code','other','label','Other','enabled',true,'action','none','free_text',true))
    WHERE tenant_id = ${sqlLit(t.id)}`);
  return { t, couponId };
}

Deno.test("winback: 'too expensive' with a coupon gets the offer once, and the answer is recorded", async () => {
  const { t } = await seedWithOffer("e2e_winback_offer");
  try {
    const r = await answer(t.apiKeyLive, { deviceRef: "dev-wb-1", reasonCode: "too_expensive" });
    assertEquals(r.status, 200, JSON.stringify(r.body));
    assertEquals(r.body.action, "offer");
    assertEquals(r.body.offer.percentOff, 50);
    assert(Date.parse(r.body.offer.expiresAt) > Date.now());
    assertEquals(r.body.offer.lanes.stripe, true);
    assertEquals(r.body.offer.lanes.razorpay, true);
    const again = await answer(t.apiKeyLive, { deviceRef: "dev-wb-1", reasonCode: "too_expensive" });
    assertEquals(again.body.action, "none", "the same buyer is offered at most once");
    const [[n, country]] = await psqlRows(`SELECT count(*), max(country) FROM exit_survey_responses WHERE tenant_id = ${sqlLit(t.id)}`);
    assertEquals(n, "2");
    assertEquals(country, "IN");
  } finally { await dropTenant(t.id); }
});

Deno.test("winback: a message reason returns its message; 'just looking' gets nothing", async () => {
  const { t } = await seedWithOffer("e2e_winback_message");
  try {
    const m = await answer(t.apiKeyLive, { deviceRef: "dev-wb-2", reasonCode: "payment_method" });
    assertEquals(m.body, { action: "message", message: "UPI works on our website." });
    const n = await answer(t.apiKeyLive, { deviceRef: "dev-wb-2", reasonCode: "just_looking" });
    assertEquals(n.body, { action: "none" });
  } finally { await dropTenant(t.id); }
});

Deno.test("winback: free text is stored only for a reason that asks for it", async () => {
  const { t } = await seedWithOffer("e2e_winback_text");
  try {
    await answer(t.apiKeyLive, { deviceRef: "dev-wb-3", reasonCode: "other", freeText: "need family plan" });
    await answer(t.apiKeyLive, { deviceRef: "dev-wb-3", reasonCode: "just_looking", freeText: "should not be kept" });
    const rows = await psqlRows(`SELECT reason_code, coalesce(free_text,'') FROM exit_survey_responses WHERE tenant_id = ${sqlLit(t.id)} ORDER BY id`);
    assertEquals(rows, [["other", "need family plan"], ["just_looking", ""]]);
  } finally { await dropTenant(t.id); }
});

Deno.test("winback: an unknown reason is refused; a bogus key is refused", async () => {
  const { t } = await seedWithOffer("e2e_winback_bad");
  try {
    assertEquals((await answer(t.apiKeyLive, { deviceRef: "d", reasonCode: "made_up" })).status, 400);
    assertEquals((await answer("pk_e2e_nope", { deviceRef: "d", reasonCode: "too_expensive" })).status, 401);
  } finally { await dropTenant(t.id); }
});

Deno.test("checkout-initiate: another buyer's or an expired offer is refused before any provider call", async () => {
  const { t } = await seedWithOffer("e2e_winback_checkout");
  try {
    const r = await answer(t.apiKeyLive, { deviceRef: "dev-wb-5", reasonCode: "too_expensive" });
    const offerId = r.body.offer.id;
    const initiate = async (email: string) => {
      const res = await fetch(`${FUNCTIONS_URL}/checkout-initiate?apiKey=${encodeURIComponent(t.apiKeyLive)}`, {
        method: "POST", headers: { "content-type": "application/json", "x-paycraft-mode": "test" },
        body: JSON.stringify({ sku: "plus-monthly", provider: "stripe", currency: "USD", customer: { email }, offerId }),
      });
      return { status: res.status, body: await res.json() };
    };
    // The offer was made to a device (no account yet); a signed-in buyer presenting it is someone else.
    const other = await initiate("someone@e2e.test");
    assertEquals(other.status, 409);
    assertEquals(other.body.error, "offer_not_usable");
    await psql(`UPDATE winback_offers SET expires_at = now() - interval '1 minute' WHERE id = ${sqlLit(offerId)}`);
    assertEquals((await initiate("someone@e2e.test")).body.error, "offer_not_usable");
  } finally { await dropTenant(t.id); }
});
