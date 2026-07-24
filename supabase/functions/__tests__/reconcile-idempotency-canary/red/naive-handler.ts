// supabase/functions/__tests__/reconcile-idempotency-canary/red/naive-handler.ts
// The DEFECT under test: a handler that trusts the payload and blind-inserts a row per event,
// with no (provider, stable_txn_id) key and no out-of-order guard. Replaying the same event
// therefore creates a SECOND row — the exact bug the real reconcile engine must not have.

interface NaiveEvent {
  provider: string;
  stableTxnId: string;
  canonicalState: string;
  latestEventTs: string;
}

const rows: NaiveEvent[] = [];

export function naiveInsert(ev: NaiveEvent): Promise<void> {
  rows.push({ ...ev }); // blind insert — no dedup, no monotonic guard
  return Promise.resolve();
}

export function rowCount(provider: string, stableTxnId: string): Promise<number> {
  return Promise.resolve(
    rows.filter((r) => r.provider === provider && r.stableTxnId === stableTxnId).length,
  );
}
