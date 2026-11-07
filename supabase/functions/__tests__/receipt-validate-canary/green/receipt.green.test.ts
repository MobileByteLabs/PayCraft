// supabase/functions/__tests__/receipt-validate-canary/green/receipt.green.test.ts
// GREEN — the REAL receipt-validate module: store-transaction ownership (claimStoreTransaction)
// and StoreKit2 JWS verification.
import "./_setup.ts"; // SUPABASE_* env — MUST precede the receipt-validate import
import { assertEquals, assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  claimStoreTransaction,
  StoreTransactionOwnedError,
  verifyStoreKit2Jws,
} from "../../../_shared/receipt-validate.ts";
import { ownerOf, seedAppleTransaction, seedToken, tamperedJws, validJws } from "./harness.ts";

// ── Ownership ────────────────────────────────────────────────────────────────
//
// A store only hands a purchase token / signed transaction to the store account that owns it, so
// presenting a VERIFIED one is proof of that account. The SDK's anonymous app-user-id is a device
// id, which changes on reinstall (iOS identifierForVendor) and on a new phone — so a store-only
// buyer restoring on a new install legitimately presents their token under a NEW id. Rejecting that
// (the previous rule) left every no-login subscriber Free after a reinstall.
//
// What still must be refused: moving a purchase AWAY from a signed-in identity. That one is
// protected by the account, and the requester has to sign in as it.

Deno.test("GREEN: anonymous owner → Play token TRANSFERS to the restoring device", async () => {
  await seedToken("tok-anon", "deviceaaaa111122");
  const res = await claimStoreTransaction("google_play", "tok-anon", "devicebbbb333344");
  assertEquals(res.transferredFrom, "deviceaaaa111122");
  assertEquals(ownerOf("google_play", "tok-anon"), "devicebbbb333344");
});

Deno.test("GREEN: anonymous owner → Apple transaction TRANSFERS (reinstall restore)", async () => {
  await seedAppleTransaction("orig-anon", "deviceaaaa111122");
  const res = await claimStoreTransaction("app_store", "orig-anon", "devicecccc555566");
  assertEquals(res.transferredFrom, "deviceaaaa111122");
  assertEquals(ownerOf("app_store", "orig-anon"), "devicecccc555566");
});

Deno.test("GREEN: anonymous owner → transfers to a signed-in email (sign-in links the purchase)", async () => {
  await seedToken("tok-link", "deviceaaaa111122");
  await claimStoreTransaction("google_play", "tok-link", "buyer@example.com");
  assertEquals(ownerOf("google_play", "tok-link"), "buyer@example.com");
});

Deno.test("GREEN: signed-in owner → an anonymous device is REFUSED with sign_in_required", async () => {
  await seedToken("tok-owned", "owner@example.com");
  const err = await assertRejects(
    () => claimStoreTransaction("google_play", "tok-owned", "devicedddd777788"),
    StoreTransactionOwnedError,
  );
  assertEquals(err.code, "sign_in_required");
  assertEquals(ownerOf("google_play", "tok-owned"), "owner@example.com", "owner must be untouched");
});

Deno.test("GREEN: signed-in owner → a DIFFERENT email is refused (no account-to-account move)", async () => {
  await seedAppleTransaction("orig-owned", "owner@example.com");
  await assertRejects(
    () => claimStoreTransaction("app_store", "orig-owned", "other@example.com"),
    StoreTransactionOwnedError,
  );
  assertEquals(ownerOf("app_store", "orig-owned"), "owner@example.com");
});

Deno.test("GREEN: same owner re-presenting is a no-op (idempotent restore)", async () => {
  await seedToken("tok-same", "owner@example.com");
  const res = await claimStoreTransaction("google_play", "tok-same", "owner@example.com");
  assertEquals(res.transferredFrom, null);
});

Deno.test("GREEN: an unseen transaction is claimable (first purchase)", async () => {
  const res = await claimStoreTransaction("app_store", "orig-never-seen", "userC");
  assertEquals(res.transferredFrom, null);
});

// ── StoreKit2 JWS ────────────────────────────────────────────────────────────

Deno.test("GREEN: StoreKit2 JWS with a tampered signature is rejected", async () => {
  await verifyStoreKit2Jws(validJws()); // valid → resolves
  await assertRejects(() => verifyStoreKit2Jws(tamperedJws()), Error, "bad signature");
});
