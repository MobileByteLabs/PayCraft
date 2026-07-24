// supabase/functions/__tests__/receipt-validate-canary/red/receipt.red.test.ts
// RED — a naive receipt path with no reuse guard accepts a token reused by a different user,
// so the "must reject reuse" assertion FAILS (the canary bites).
import { assertRejects } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { naiveAcceptToken } from "./naive-receipt.ts";

Deno.test("RED: a reused purchaseToken is wrongly accepted", async () => {
  await naiveAcceptToken("tok-1", "userA");
  // Reuse by a different user MUST be rejected; the naive impl does not reject, so this FAILS.
  await assertRejects(() => naiveAcceptToken("tok-1", "userB"), Error, "reuse");
});
