// entitlement-reconcile builds its Supabase client at import time — env first, then import.
Deno.env.set("SUPABASE_URL", "http://stub.local");
Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "stub-service-role-key");

import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import type { PlaySyncDeps } from "../store-sync.ts";
import type { CanonicalEvent } from "../entitlement-reconcile.ts";
const { appleHistory, syncPlayTenant } = await import("../store-sync.ts");

const T = "bba1842f-3a57-41cd-8705-94db588de056";
const future = new Date(Date.now() + 86_400_000).toISOString();
const activeSub = { subscriptionState: "SUBSCRIPTION_STATE_ACTIVE", lineItems: [{ productId: "premium", expiryTime: future, autoRenewingPlan: { autoRenewEnabled: true } }] };
const expiredSub = { subscriptionState: "SUBSCRIPTION_STATE_EXPIRED", lineItems: [{ productId: "premium", expiryTime: new Date(0).toISOString() }] };

function deps(over: Partial<PlaySyncDeps> = {}) {
  const written: CanonicalEvent[] = [];
  const d: PlaySyncDeps = {
    voidedTokens: () => Promise.resolve([]),
    knownTokens: () => Promise.resolve([{ token: "tok-a", appUserId: "u@x.test" }]),
    truth: () => Promise.resolve(activeSub),
    reconcile: (ev) => (written.push(ev), Promise.resolve()),
    ...over,
  };
  return { d, written };
}

Deno.test("every known token is re-read from Google and reconciled under its app", async () => {
  const { d, written } = deps();
  const r = await syncPlayTenant(T, d);
  assertEquals([r.rechecked, r.refunded, r.errors], [1, 0, 0]);
  assertEquals([written[0].tenantId, written[0].canonicalState, written[0].stableTxnId], [T, "active", "tok-a"]);
});

Deno.test("a token Google lists as voided is recorded as refunded, never left active", async () => {
  const { d, written } = deps({ voidedTokens: () => Promise.resolve(["tok-a"]), truth: () => Promise.resolve(expiredSub) });
  const r = await syncPlayTenant(T, d);
  assertEquals(r.refunded, 1);
  assertEquals([written[0].canonicalState, written[0].willRenew], ["refunded", false]);
});

Deno.test("the voided list is passed to knownTokens so an old refunded token is still looked up", async () => {
  let asked: string[] = [];
  const { d } = deps({ voidedTokens: () => Promise.resolve(["old-tok"]), knownTokens: (v) => (asked = v, Promise.resolve([])) });
  await syncPlayTenant(T, d);
  assertEquals(asked, ["old-tok"]);
});

Deno.test("one token failing does not stop the rest", async () => {
  const { d, written } = deps({
    knownTokens: () => Promise.resolve([{ token: "bad", appUserId: "a" }, { token: "good", appUserId: "b" }]),
    truth: (t) => t === "bad" ? Promise.reject(new Error("410 gone")) : Promise.resolve(activeSub),
  });
  const r = await syncPlayTenant(T, d);
  assertEquals([r.rechecked, r.errors, written.length], [1, 1, 1]);
});

Deno.test("Apple history follows pagination and returns every signed payload", async () => {
  const pages = [
    { notificationHistory: [{ signedPayload: "p1" }, { signedPayload: "p2" }], hasMore: true, paginationToken: "next" },
    { notificationHistory: [{ signedPayload: "p3" }], hasMore: false },
  ];
  const urls: string[] = [];
  const fetchFn = (u: string) => (urls.push(u), Promise.resolve(new Response(JSON.stringify(pages[urls.length - 1]))));
  assertEquals(await appleHistory("https://h", "jwt", 0, 1, fetchFn), ["p1", "p2", "p3"]);
  assertEquals(urls[1].endsWith("?paginationToken=next"), true);
});
