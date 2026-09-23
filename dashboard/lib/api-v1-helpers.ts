import { NextResponse } from "next/server"
import { requireApiKey, isFailure, type ApiScope, type ApiKeyContext } from "@/lib/api-key-auth"
import { queryFailed, withSecurityHeaders } from "@/lib/api-security"

/**
 * Shared shape for the v1 read endpoints.
 *
 * Every list endpoint does the same four things — authenticate, scope-check, page, filter by the
 * key's tenant — and the fourth is the one that must never be got wrong. Writing it once means a
 * new resource cannot accidentally omit the tenant filter, which on a service-role client (no RLS)
 * would return every tenant's rows.
 */

export const MAX_LIMIT = 200
const DEFAULT_LIMIT = 50

export interface Page {
  limit: number
  offset: number
}

export function parsePage(req: Request): Page {
  const q = new URL(req.url).searchParams
  const rawLimit = Number(q.get("limit") ?? DEFAULT_LIMIT)
  const rawOffset = Number(q.get("offset") ?? 0)
  return {
    // Clamped, not rejected. An out-of-range limit is a caller who wants "as much as possible", and
    // failing the request teaches them to retry in a loop; capping answers it once.
    limit: Number.isFinite(rawLimit) ? Math.min(Math.max(1, Math.trunc(rawLimit)), MAX_LIMIT) : DEFAULT_LIMIT,
    offset: Number.isFinite(rawOffset) ? Math.max(0, Math.trunc(rawOffset)) : 0,
  }
}

/**
 * Authenticate, then run a tenant-scoped query and render it as a paged list.
 *
 * `table` + `columns` are explicit at every call site rather than `select("*")`: several of these
 * tables carry secrets in adjacent columns (`tenants.webhook_secret_live`,
 * `tenants.api_key_live`), and a wildcard select would put them in an API response the first time
 * someone added a column.
 */
export async function listResource(
  req: Request,
  scope: ApiScope,
  opts: {
    table: string
    columns: string
    orderBy?: { column: string; ascending?: boolean }
    /** Extra equality filters from the query string, e.g. { provider: "stripe" }. */
    filters?: (q: URLSearchParams) => Record<string, string | null>
  },
) {
  const ctx = await requireApiKey(req, scope)
  if (isFailure(ctx)) return ctx.failed

  const { limit, offset } = parsePage(req)
  const q = new URL(req.url).searchParams

  let query = ctx.admin
    .from(opts.table)
    .select(opts.columns, { count: "exact" })
    // The tenant comes from the KEY. Never from the request — see api-key-auth.
    .eq("tenant_id", ctx.tenantId)
    .range(offset, offset + limit - 1)

  if (opts.orderBy) {
    query = query.order(opts.orderBy.column, { ascending: opts.orderBy.ascending ?? false })
  }
  for (const [k, v] of Object.entries(opts.filters?.(q) ?? {})) {
    if (v !== null && v !== "") query = query.eq(k, v)
  }

  const { data, error, count } = await query
  if (error) return queryFailed(`v1/${opts.table}`, error) as NextResponse

  return withSecurityHeaders(
    NextResponse.json({
    data: data ?? [],
    pagination: {
      limit,
      offset,
      total: count ?? null,
      // Saves a caller doing arithmetic to discover there is another page.
      has_more: count !== null ? offset + (data?.length ?? 0) < count : (data?.length ?? 0) === limit,
    },
    }),
  ) as NextResponse
}

/** Authenticate and hand back the context, for endpoints that are not a plain list. */
export async function withApiKey(
  req: Request,
  scope: ApiScope,
  fn: (ctx: ApiKeyContext) => Promise<NextResponse>,
) {
  const ctx = await requireApiKey(req, scope)
  if (isFailure(ctx)) return ctx.failed
  // Centralised so an endpoint cannot ship without the headers by forgetting to add them.
  return withSecurityHeaders(await fn(ctx)) as NextResponse
}
