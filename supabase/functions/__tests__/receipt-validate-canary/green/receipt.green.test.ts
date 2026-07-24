// supabase/functions/__tests__/receipt-validate-canary/green/receipt.green.test.ts
// GREEN — the REAL receipt-validate module: a reused Play purchaseToken is rejected, and a
// StoreKit2 JWS with a tampered signature is rejected while a valid one resolves.
import "./_setup.ts"; // SUPABASE_* env — MUST precede the receipt-validate import
import { assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  assertPlayTokenNotReused,
  verifyStoreKit2Jws,
} from "../../../_shared/receipt-validate.ts";
import { seedToken, tamperedJws, validJws } from "./harness.ts";

Deno.test("GREEN: reused Play purchaseToken is rejected", async () => {
  await seedToken("tok-1", "userA");
  await assertRejects(() => assertPlayTokenNotReused("tok-1", "userB"), Error, "reuse rejected");
});

Deno.test("GREEN: same-user Play purchaseToken re-presentation is allowed (idempotent restore)", async () => {
  await seedToken("tok-2", "userA");
  await assertPlayTokenNotReused("tok-2", "userA"); // must NOT throw
});

Deno.test("GREEN: StoreKit2 JWS with a tampered signature is rejected", async () => {
  await verifyStoreKit2Jws(validJws()); // valid → resolves
  await assertRejects(() => verifyStoreKit2Jws(tamperedJws()), Error, "bad signature");
});
