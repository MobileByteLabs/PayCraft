// supabase/functions/__tests__/reconcile-idempotency-canary/green/owner.green.test.ts
// GREEN — a store WEBHOOK must not re-own an entitlement row.
//
// Webhooks only know the store's hashed id (Play obfuscatedAccountId, Apple appAccountToken), never
// the SDK's app-user-id. Letting them write app_user_id re-keyed every row on its first renewal to a
// value get_entitlements(appUserId) never asks for — a paying user read Free from then on — and
// undid any restore transfer. Ownership is the claim path's job; a webhook only updates STATE.
import "./_setup.ts"; // sets SUPABASE_* env — MUST precede the reconcile-module import
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { type CanonicalEvent, reconcileEntitlement } from "../../../_shared/entitlement-reconcile.ts";
import { insertRow, latestState, onNextWrite, ownerOf, rowCount } from "./harness.ts";

const purchase: CanonicalEvent = {
  provider: "google_play",
  stableTxnId: "tok-owner-1",
  appUserId: "buyer@example.com", // written by the client grant endpoint
  tenantId: null,
  productId: "pro",
  canonicalState: "active",
  expiresAt: null,
  willRenew: true,
  inGraceUntil: null,
  isSandbox: true,
  latestEventTs: "2026-10-01T00:00:00Z",
};

Deno.test("GREEN: a webhook renewal keeps the existing owner and still updates state", async () => {
  await reconcileEntitlement(purchase);
  await reconcileEntitlement(
    { ...purchase, appUserId: "9f2c1a…obfuscated", canonicalState: "in_grace_period", latestEventTs: "2026-11-01T00:00:00Z" },
    { preserveOwner: true },
  );
  assertEquals(await ownerOf("google_play", "tok-owner-1"), "buyer@example.com");
  assertEquals(await latestState("google_play", "tok-owner-1"), "in_grace_period");
});

// Device finding 2026-11-08 (reels, Play purchase): the PURCHASED notification read "no row", the SDK's
// grant inserted the row under the buyer's id, then the notification's upsert overwrote the owner with
// Play's hashed id — the buyer read Free until their next app launch re-claimed it.
Deno.test("GREEN: a webhook racing the SDK grant never overwrites the owner the grant wrote", async () => {
  onNextWrite(() =>
    insertRow({
      provider: "google_play",
      stable_txn_id: "tok-race-1",
      app_user_id: "buyer@example.com",
      canonical_state: "active",
      latest_event_ts: "2026-10-01T00:00:00Z",
    })
  );
  await reconcileEntitlement(
    { ...purchase, stableTxnId: "tok-race-1", appUserId: "d23892b4…obfuscated", latestEventTs: "2026-10-01T00:00:01Z" },
    { preserveOwner: true },
  );
  assertEquals(await ownerOf("google_play", "tok-race-1"), "buyer@example.com");
  assertEquals(await rowCount("google_play", "tok-race-1"), 1);
});

Deno.test("GREEN: an older webhook never rolls state back", async () => {
  await reconcileEntitlement({ ...purchase, stableTxnId: "tok-old-1", latestEventTs: "2026-10-02T00:00:00Z" });
  await reconcileEntitlement(
    { ...purchase, stableTxnId: "tok-old-1", canonicalState: "expired", latestEventTs: "2026-10-01T00:00:00Z" },
    { preserveOwner: true },
  );
  assertEquals(await latestState("google_play", "tok-old-1"), "active");
});

Deno.test("GREEN: a webhook for an UNSEEN transaction still creates the row with its own id", async () => {
  await reconcileEntitlement({ ...purchase, stableTxnId: "tok-owner-2", appUserId: "hashed-id" }, { preserveOwner: true });
  assertEquals(await ownerOf("google_play", "tok-owner-2"), "hashed-id");
});
