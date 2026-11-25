/**
 * A Supabase client stand-in that APPLIES the filters a query builds to seeded rows — so a lib query that forgets
 * `.eq("tenant_id", …)` really does return another tenant's rows in the test, the way it would against Postgres
 * with a service key. Supports the subset the dashboard's read modules use: select (projection), eq, neq, in, is,
 * gte, lt, not(col, "is", null), order (multi-key, nullsFirst), limit, range, maybeSingle and
 * `{ count: "exact", head: true }`.
 *
 * Every executed query is recorded on `calls` so a test can assert which tables were read with which filters.
 */

type Row = Record<string, unknown>
type Filter = (r: Row) => boolean
type Order = { col: string; ascending: boolean; nullsFirst: boolean }

export type FakeCall = { table: string; filters: string[] }

export function fakeSupabase(tables: Record<string, Row[]>) {
  const calls: FakeCall[] = []

  function from(table: string) {
    const filters: Filter[] = []
    const described: string[] = []
    const orders: Order[] = []
    let columns: string[] | null = null
    let max: number | null = null
    let skip = 0
    let single = false
    let countMode = false
    let headOnly = false

    const builder = {
      select(cols = "*", opts?: { count?: "exact"; head?: boolean }) {
        columns = cols.trim() === "*" ? null : cols.split(",").map((c) => c.trim()).filter(Boolean)
        countMode = opts?.count === "exact"
        headOnly = opts?.head === true
        return builder
      },
      eq(col: string, v: unknown) {
        described.push(`eq:${col}=${String(v)}`)
        filters.push((r) => r[col] === v)
        return builder
      },
      neq(col: string, v: unknown) {
        described.push(`neq:${col}=${String(v)}`)
        filters.push((r) => r[col] !== v)
        return builder
      },
      in(col: string, vs: unknown[]) {
        described.push(`in:${col}`)
        filters.push((r) => vs.includes(r[col]))
        return builder
      },
      is(col: string, v: null) {
        described.push(`is:${col}=${String(v)}`)
        filters.push((r) => (r[col] ?? null) === v)
        return builder
      },
      not(col: string, op: "is", v: null) {
        described.push(`not:${col} ${op} ${String(v)}`)
        filters.push((r) => (r[col] ?? null) !== v)
        return builder
      },
      gte(col: string, v: string) {
        described.push(`gte:${col}`)
        filters.push((r) => typeof r[col] === "string" && (r[col] as string) >= v)
        return builder
      },
      lt(col: string, v: string) {
        described.push(`lt:${col}`)
        filters.push((r) => typeof r[col] === "string" && (r[col] as string) < v)
        return builder
      },
      order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
        const ascending = opts?.ascending ?? true
        orders.push({ col, ascending, nullsFirst: opts?.nullsFirst ?? !ascending })
        return builder
      },
      limit(n: number) {
        max = n
        return builder
      },
      range(fromIdx: number, toIdx: number) {
        described.push(`range:${fromIdx}-${toIdx}`)
        skip = fromIdx
        max = toIdx - fromIdx + 1
        return builder
      },
      maybeSingle() {
        single = true
        return builder
      },
      then<T>(resolve: (v: { data: Row[] | null; error: null; count: number | null }) => T, reject?: (e: unknown) => T) {
        try {
          calls.push({ table, filters: described })
          let rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)))
          const count = rows.length
          if (orders.length) {
            rows = [...rows].sort((a, b) => {
              for (const o of orders) {
                const av = a[o.col] ?? null
                const bv = b[o.col] ?? null
                if (av === bv) continue
                if (av === null) return o.nullsFirst ? -1 : 1
                if (bv === null) return o.nullsFirst ? 1 : -1
                const c = String(av) < String(bv) ? -1 : 1
                return o.ascending ? c : -c
              }
              return 0
            })
          }
          rows = rows.slice(skip, max !== null ? skip + max : undefined)
          const projected = columns ? rows.map((r) => Object.fromEntries(columns!.map((c) => [c, r[c] ?? null]))) : rows
          if (single) {
            // PostgREST's maybeSingle: one row or null, and an error (not an arbitrary pick) when several match.
            if (projected.length > 1) {
              return Promise.resolve(resolve({ data: null, error: { message: "multiple rows" }, count: null } as never))
            }
            return Promise.resolve(resolve({ data: (projected[0] ?? null) as never, error: null, count: null }))
          }
          return Promise.resolve(resolve({ data: headOnly ? null : projected, error: null, count: countMode ? count : null }))
        } catch (e) {
          return reject ? Promise.resolve(reject(e)) : Promise.reject(e)
        }
      },
    }
    return builder
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from } as any, calls }
}
