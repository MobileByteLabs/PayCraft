// supabase/functions/__tests__/_fake-attempt-db.ts
//
// An in-memory stand-in for the supabase-js query builder over the attempt tables (migration 210), for unit
// tests of _shared/payment-attempts.ts and attempt-stitch. It behaves like the database where the code under
// test depends on it:
//   · checkout_attempts refuses an undeclared state edge with the guard's own error (code 23514,
//     `attempt_illegal_transition: …` / `attempt_terminal: …`), using the SAME edge table the migration
//     declares (supabase/tests/210_payment_attempts_test.sql proves the SQL side of that table);
//   · unique keys: checkout_attempts.attempt_id and (provider, provider_session_id),
//     appstore_txn_attempt_map.original_transaction_id — a duplicate INSERT fails with 23505 unless the
//     upsert asks to ignore or merge it;
//   · every write is recorded in `log` so a test can assert the exact filters a caller used.
// Only the builder methods the attempt code calls are implemented; anything else throws, so a test can
// never pass by silently exercising an unimplemented path.

import { canTransition, type AttemptState } from "../_shared/payment-attempts.ts"

export type Row = Record<string, unknown>
export interface WriteLog {
  table: string
  op: "insert" | "upsert" | "update"
  payload: Row
  filters: string[]
}

type Filter = { text: string; test: (r: Row) => boolean }

const UNIQUE: Record<string, string[][]> = {
  checkout_attempts: [["attempt_id"], ["provider", "provider_session_id"]],
  appstore_txn_attempt_map: [["original_transaction_id"]],
}

export class FakeAttemptDb {
  tables: Record<string, Row[]> = { checkout_attempts: [], attempt_events: [], appstore_txn_attempt_map: [] }
  log: WriteLog[] = []
  rpcCalls: Array<{ fn: string; params: Record<string, unknown> }> = []
  private seq = 0

  from(table: string): Query {
    if (!(table in this.tables)) throw new Error(`fake db: unknown table ${table}`)
    return new Query(this, table)
  }

  rpc(fn: string, params: Record<string, unknown>) {
    this.rpcCalls.push({ fn, params })
    return Promise.resolve({ data: [{ paid_not_granted: 0, abandoned: 0 }], error: null })
  }

  /** Seeds a row directly, as another writer (an old webhook, the SDK RPC) would have. */
  seed(table: string, row: Row): Row {
    const r = { id: `row-${++this.seq}`, ...row }
    this.tables[table].push(r)
    return r
  }

  attempt(attemptId: string): Row | undefined {
    return this.tables.checkout_attempts.find((r) => r.attempt_id === attemptId)
  }

  events(attemptId: string): Row[] {
    return this.tables.attempt_events.filter((r) => r.attempt_id === attemptId)
  }

  nextId(): string {
    return `row-${++this.seq}`
  }
}

type Result = { data: unknown; error: { code: string; message: string } | null }

class Query implements PromiseLike<Result> {
  private op: "select" | "insert" | "upsert" | "update" = "select"
  private payload: Row | Row[] = {}
  private opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}
  private filters: Filter[] = []
  private returning = false
  private single = false
  private limitN: number | null = null

  constructor(private db: FakeAttemptDb, private table: string) {}

  select(_cols?: string): this {
    if (this.op !== "select") this.returning = true
    return this
  }
  insert(p: Row | Row[]): this {
    this.op = "insert"
    this.payload = p
    return this
  }
  upsert(p: Row | Row[], opts: { onConflict?: string; ignoreDuplicates?: boolean } = {}): this {
    this.op = "upsert"
    this.payload = p
    this.opts = opts
    return this
  }
  update(p: Row): this {
    this.op = "update"
    this.payload = p
    return this
  }
  eq(c: string, v: unknown): this {
    this.filters.push({ text: `${c}=${v}`, test: (r) => r[c] === v })
    return this
  }
  neq(c: string, v: unknown): this {
    this.filters.push({ text: `${c}!=${v}`, test: (r) => r[c] !== v })
    return this
  }
  is(c: string, v: null): this {
    this.filters.push({ text: `${c} is ${v}`, test: (r) => (r[c] ?? null) === v })
    return this
  }
  in(c: string, vs: unknown[]): this {
    this.filters.push({ text: `${c} in (${vs.join(",")})`, test: (r) => vs.includes(r[c]) })
    return this
  }
  order(_c: string, _o?: unknown): this {
    return this
  }
  limit(n: number): this {
    this.limitN = n
    return this
  }
  maybeSingle(): this {
    this.single = true
    return this
  }

  then<A = Result, B = never>(ok?: ((v: Result) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve().then(() => this.exec()).then(ok, ko)
  }

  private exec(): Result {
    const rows = this.db.tables[this.table]
    const hit = (r: Row) => this.filters.every((f) => f.test(r))
    if (this.op === "select") {
      let out = rows.filter(hit).map((r) => ({ ...r }))
      if (this.limitN !== null) out = out.slice(0, this.limitN)
      return { data: this.single ? (out[0] ?? null) : out, error: null }
    }
    this.db.log.push({
      table: this.table,
      op: this.op,
      payload: Array.isArray(this.payload) ? { rows: this.payload } : { ...this.payload },
      filters: this.filters.map((f) => f.text),
    })
    if (this.op === "update") return this.execUpdate(rows.filter(hit))
    return this.execInsert(Array.isArray(this.payload) ? this.payload : [this.payload])
  }

  private execUpdate(targets: Row[]): Result {
    const p = this.payload as Row
    for (const r of targets) {
      if (this.table === "checkout_attempts" && typeof p.state === "string" && p.state !== r.state) {
        const from = r.state as AttemptState
        const to = p.state as AttemptState
        if (from === "granted") {
          return { data: null, error: { code: "23514", message: `attempt_terminal: granted is terminal (attempt_id=${r.attempt_id})` } }
        }
        if (!canTransition(from, to)) {
          return { data: null, error: { code: "23514", message: `attempt_illegal_transition: ${from} → ${to} (attempt_id=${r.attempt_id})` } }
        }
      }
    }
    // Unique keys hold on UPDATE too: a new value another row already carries is a 23505.
    const rows = this.db.tables[this.table]
    for (const r of targets) {
      const after = { ...r, ...p }
      for (const cols of UNIQUE[this.table] ?? []) {
        if (!cols.some((c) => c in p)) continue
        const clash = rows.find((o) => o !== r && cols.every((c) => after[c] !== undefined && after[c] !== null && o[c] === after[c]))
        if (clash) {
          return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint ${this.table}(${cols.join(",")})` } }
        }
      }
    }
    for (const r of targets) Object.assign(r, p)
    return { data: this.returning ? targets.map((r) => ({ ...r })) : null, error: null }
  }

  private execInsert(incoming: Row[]): Result {
    const rows = this.db.tables[this.table]
    const written: Row[] = []
    for (const raw of incoming) {
      const row: Row = { id: this.db.nextId(), ...raw }
      if (this.table === "checkout_attempts" && row.attempt_id && !row.correlation) row.correlation = "exact"
      // ON CONFLICT names ONE key: a clash on it is ignored / merged; a clash on any other unique key
      // still raises 23505, exactly as Postgres does.
      const target = (this.opts.onConflict ?? "").split(",").map((c) => c.trim()).filter(Boolean).join(",")
      let merged = false
      for (const cols of UNIQUE[this.table] ?? []) {
        const clash = rows.find((r) => cols.every((c) => row[c] !== undefined && row[c] !== null && r[c] === row[c]))
        if (!clash) continue
        if (this.op === "upsert" && cols.join(",") === target) {
          if (!this.opts.ignoreDuplicates) {
            Object.assign(clash, raw)
            written.push({ ...clash })
          }
          merged = true
          break
        }
        return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint ${this.table}(${cols.join(",")})` } }
      }
      if (merged) continue
      rows.push(row)
      written.push({ ...row })
    }
    return { data: this.returning ? written : null, error: null }
  }
}
