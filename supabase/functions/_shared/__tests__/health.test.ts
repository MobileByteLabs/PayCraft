import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { type FetchLike, healthResponse, stripeCheck } from "../health.ts";

// Stripe answers per key: how many events that account still cannot deliver.
const stripe = (undeliveredByKey: Record<string, number>, calls: string[] = []): FetchLike => (_url, init) => {
  const key = String((init?.headers as Record<string, string>).Authorization).replace("Bearer ", "");
  calls.push(key);
  if (!(key in undeliveredByKey)) return Promise.resolve(new Response("{}", { status: 401 }));
  return Promise.resolve(new Response(JSON.stringify({ data: Array(undeliveredByKey[key]).fill({}) })));
};

Deno.test("all delivered → ok", async () => {
  assertEquals((await stripeCheck(["sk_a"], stripe({ sk_a: 0 }))).ok, true);
});

Deno.test("any undelivered event → not ok, with the count", async () => {
  const c = await stripeCheck(["sk_a", "sk_b"], stripe({ sk_a: 0, sk_b: 3 }));
  assertEquals([c.ok, c.detail], [false, "3 event(s) Stripe cannot deliver"]);
});

Deno.test("a shared account is asked once", async () => {
  const calls: string[] = [];
  await stripeCheck(["sk_a", "sk_a", "sk_a"], stripe({ sk_a: 0 }, calls));
  assertEquals(calls, ["sk_a"]);
});

Deno.test("Stripe unreachable or key rejected → not ok (never silently green)", async () => {
  assertEquals((await stripeCheck(["sk_revoked"], stripe({}))).ok, false);
});

Deno.test("503 + degraded when any check fails; body carries no key", async () => {
  const res = healthResponse({ db: { ok: true, detail: "" }, stripe: { ok: false, detail: "2 event(s) Stripe cannot deliver" } });
  assertEquals(res.status, 503);
  const body = await res.text();
  assertEquals(JSON.parse(body).status, "degraded");
  assertEquals(body.includes("sk_"), false);
});

Deno.test("200 + ok when every check passes", async () => {
  assertEquals(healthResponse({ db: { ok: true, detail: "" } }).status, 200);
});

import { type IncidentStore, recordTransitions } from "../health.ts";

// In-memory twin of migration 185: one open incident per check.
function memStore(): IncidentStore & { open_: Map<string, Date> } {
  const open_ = new Map<string, Date>();
  return {
    open_,
    open: (c) => Promise.resolve(open_.has(c) ? false : (open_.set(c, new Date(0)), true)),
    resolve: (c) => {
      const at = open_.get(c) ?? null;
      open_.delete(c);
      return Promise.resolve(at);
    },
  };
}

Deno.test("a check that starts failing sends ONE alert, however many polls see it", async () => {
  const store = memStore(), sent: string[] = [];
  const failing = { stripe_live: { ok: false, detail: "3 event(s) Stripe cannot deliver" } };
  for (let i = 0; i < 4; i++) await recordTransitions(failing, store, (s) => (sent.push(s), Promise.resolve()));
  assertEquals(sent.length, 1);
  assertEquals(sent[0].includes("stripe_live") && sent[0].includes("FAILING"), true);
});

Deno.test("recovery sends one resolved email; a healthy check never emails", async () => {
  const store = memStore(), sent: string[] = [];
  const mail = (s: string) => (sent.push(s), Promise.resolve());
  await recordTransitions({ db: { ok: true, detail: "" } }, store, mail);
  assertEquals(sent, []);
  await recordTransitions({ db: { ok: false, detail: "down" } }, store, mail);
  await recordTransitions({ db: { ok: true, detail: "" } }, store, mail);
  await recordTransitions({ db: { ok: true, detail: "" } }, store, mail);
  assertEquals(sent.length, 2);
  assertEquals(sent[1].includes("RESOLVED"), true);
});

Deno.test("a mail failure never breaks the health answer", async () => {
  await recordTransitions({ db: { ok: false, detail: "x" } }, memStore(), () => Promise.reject(new Error("resend down")));
});
