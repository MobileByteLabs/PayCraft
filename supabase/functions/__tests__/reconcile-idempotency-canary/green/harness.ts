// supabase/functions/__tests__/reconcile-idempotency-canary/green/harness.ts
//
// In-memory PostgREST emulation for the entitlement_records table. Installs a globalThis.fetch
// stub that the real supabase-admin client hits, backed by an in-memory row store keyed on
// (provider, stable_txn_id) so we exercise the REAL reconcileEntitlement code — its select/guard/
// upsert logic — with no live database. Request shapes verified against supabase-js@2:
//   SELECT+maybeSingle → GET  /rest/v1/entitlement_records?select=...&provider=eq.X&stable_txn_id=eq.Y
//   UPSERT             → POST /rest/v1/entitlement_records?on_conflict=provider%2Cstable_txn_id

interface Row {
  [k: string]: unknown;
  provider: string;
  stable_txn_id: string;
}

const table: Row[] = [];
const RESERVED = new Set(["select", "on_conflict", "order", "limit", "offset"]);

function matches(row: Row, params: URLSearchParams): boolean {
  for (const [key, val] of params) {
    if (RESERVED.has(key)) continue;
    if (val.startsWith("eq.")) {
      if (String(row[key]) !== val.slice(3)) return false;
    }
  }
  return true;
}

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const originalFetch = globalThis.fetch;
globalThis.fetch = (async (input: Request | URL | string, init?: RequestInit): Promise<Response> => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const method = (init?.method ?? "GET").toUpperCase();

  if (url.includes("/rest/v1/entitlement_records")) {
    const parsed = new URL(url);
    if (method === "GET") {
      const hits = table.filter((r) => matches(r, parsed.searchParams));
      return json(hits, 200);
    }
    if (method === "POST") {
      const body = JSON.parse(init!.body as string) as Row;
      const idx = table.findIndex(
        (r) => r.provider === body.provider && r.stable_txn_id === body.stable_txn_id,
      );
      if (idx >= 0) table[idx] = { ...table[idx], ...body };
      else table.push({ ...body });
      return json([body], 201);
    }
  }
  // Anything else (should not happen in this canary) falls through to the real fetch.
  return originalFetch(input as Request, init);
}) as typeof fetch;

export function rowCount(provider: string, stableTxnId: string): Promise<number> {
  return Promise.resolve(
    table.filter((r) => r.provider === provider && r.stable_txn_id === stableTxnId).length,
  );
}

export function latestState(provider: string, stableTxnId: string): Promise<string | null> {
  const row = table.find((r) => r.provider === provider && r.stable_txn_id === stableTxnId);
  return Promise.resolve(row ? (row.canonical_state as string) : null);
}
