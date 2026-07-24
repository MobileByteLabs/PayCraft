// supabase/functions/__tests__/reconcile-idempotency-canary/red/reconcile.red.test.ts
// RED — a naive handler that trusts the payload and blind-inserts; replaying the same
// event MUST create two rows, so the single-row assertion FAILS (the canary bites).
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { naiveInsert, rowCount } from "./naive-handler.ts";

Deno.test("RED: non-idempotent handler duplicates entitlement rows on replay", async () => {
  const ev = {
    provider: "app_store",
    stableTxnId: "txn-1",
    canonicalState: "active",
    latestEventTs: "2026-07-21T00:00:00Z",
  };
  await naiveInsert(ev);
  await naiveInsert(ev); // replay of the SAME event
  assertEquals(await rowCount("app_store", "txn-1"), 1); // FAILS: naive yields 2
});
