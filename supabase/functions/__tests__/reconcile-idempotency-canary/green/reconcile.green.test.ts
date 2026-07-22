// supabase/functions/__tests__/reconcile-idempotency-canary/green/reconcile.green.test.ts
// GREEN — drive the REAL reconcileEntitlement with a newer event, a stale (out-of-order) replay,
// and an exact replay; assert exactly one row survives at the latest truth (in_grace_period).
import "./_setup.ts"; // sets SUPABASE_* env — MUST precede the reconcile-module import
import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import {
  type CanonicalEvent,
  reconcileEntitlement,
} from "../../../_shared/entitlement-reconcile.ts";
import { latestState, rowCount } from "./harness.ts";

Deno.test("GREEN: replay twice + out-of-order → exactly one row at latest truth", async () => {
  const older: CanonicalEvent = {
    provider: "app_store",
    stableTxnId: "txn-1",
    appUserId: "u1",
    tenantId: null,
    productId: "pro",
    canonicalState: "active",
    expiresAt: null,
    willRenew: true,
    inGraceUntil: null,
    isSandbox: true,
    latestEventTs: "2026-07-21T00:00:00Z",
  };
  const newer: CanonicalEvent = {
    ...older,
    canonicalState: "in_grace_period",
    latestEventTs: "2026-07-21T02:00:00Z",
  };

  await reconcileEntitlement(newer);
  await reconcileEntitlement(older); // out-of-order (stale) — must NOT overwrite
  await reconcileEntitlement(newer); // replay — idempotent

  assertEquals(await rowCount("app_store", "txn-1"), 1);
  assertEquals(await latestState("app_store", "txn-1"), "in_grace_period");
});
