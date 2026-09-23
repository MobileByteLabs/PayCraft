import { NextResponse } from "next/server"
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js"
import {
  SECURITY_HEADERS,
  checkAuthAttempts,
  recordAuthFailure,
  recordAuthFailureShared,
  tooManyAttempts,
  withSecurityHeaders,
} from "@/lib/api-security"

/**
 * Bearer-token authentication for the machine-facing management API (`/api/v1/*`).
 *
 * WHY THIS EXISTS
 * Every other admin surface authenticates with `auth.getUser()`, which needs a human session. The
 * owner account signs in with Google, Google has no password, and Google refuses automated browsers
 * outright — so before this there was NO way for CI or an agent to run an admin operation.
 *
 * THE THREE RULES THIS FILE ENFORCES, IN ORDER
 *
 * 1. IDENTITY COMES FROM THE KEY, NEVER FROM THE REQUEST.
 *    `verify` returns the tenant the key was issued for, and callers must use THAT — never a
 *    `tenant_id` in the body or query. A key is a bearer credential; if the payload could name the
 *    tenant, any valid key would be a key to every tenant. This is the single most important
 *    property here, which is why the context object exposes `tenantId` and the routes take no
 *    tenant parameter at all.
 *
 * 2. SCOPE IS CHECKED PER ROUTE, NOT PER KEY.
 *    A key carries a closed set of scopes (constrained in the database, migration 136). Each route
 *    names the one scope it needs. A read key therefore cannot bulk-write to live payment
 *    providers even though both routes sit behind the same authentication.
 *
 * 3. EVERY OUTCOME IS RATE-LIMITED AND AUDITED.
 *    Including the failures — an unauthenticated storm is exactly the traffic you most need a
 *    record of, and an empty log during one looks identical to no traffic at all.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 * It does not fall back to a session. A route that accepts either a key or a cookie has two
 * authorization paths to keep correct forever, and the weaker one decides the security of both.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY!

/** Scopes the API recognises. Mirrors the CHECK constraint in migration 136 — keep the two in step. */
export type ApiScope =
  | "readiness:read"
  | "providers:read"
  | "products:read"
  | "products:sync"
  | "tenant:read"
  | "subscribers:read"
  | "coupons:read"
  | "paywall:read"
  | "audit:read"
  | "webhooks:read"

export interface ApiKeyContext {
  tenantId: string
  keyId: string
  scopes: string[]
  /** Service-role client. RLS does not apply to it, so every query MUST filter by `tenantId`. */
  admin: SupabaseClient<any>
}

/** A failed authentication, already rendered. Callers return it unchanged. */
export type ApiKeyFailure = { failed: NextResponse }

export function isFailure(v: ApiKeyContext | ApiKeyFailure): v is ApiKeyFailure {
  return (v as ApiKeyFailure).failed !== undefined
}

function fail(status: number, error: string, detail?: string): ApiKeyFailure {
  return {
    failed: withSecurityHeaders(
      NextResponse.json(detail ? { error, detail } : { error }, {
        status,
        headers: {
          ...SECURITY_HEADERS,
          // Tell a client how to authenticate rather than leaving it to guess.
          ...(status === 401 ? { "WWW-Authenticate": 'Bearer realm="paycraft"' } : {}),
        },
      }),
    ) as NextResponse,
  }
}

/**
 * Authenticate the request and assert one scope.
 *
 * Returns a context on success, or an already-rendered response on failure. Callers do:
 *
 *   const ctx = await requireApiKey(req, "products:sync")
 *   if (isFailure(ctx)) return ctx.failed
 */
export async function requireApiKey(
  req: Request,
  scope: ApiScope,
): Promise<ApiKeyContext | ApiKeyFailure> {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    // Naming the variable matters: a generic "server error" here is indistinguishable from an
    // outage, and this particular misconfiguration has cost this codebase a day before.
    return fail(500, "server_misconfigured", "SUPABASE_SERVICE_ROLE_KEY is not set")
  }

  // Throttle BEFORE touching the header, the database or anything else. An attempt that is going
  // to be rejected should cost the attacker more than it costs us, and every step taken before this
  // check is work a stranger can compel for free.
  const attempts = checkAuthAttempts(req)
  if (!attempts.allowed) return { failed: tooManyAttempts(attempts) as NextResponse }

  const header = req.headers.get("authorization") ?? ""
  const match = /^Bearer\s+(\S+)$/i.exec(header)
  if (!match) {
    recordAuthFailure(req)
    return fail(401, "missing_bearer_token")
  }

  const key = match[1]
  // Reject anything not shaped like our key BEFORE hitting the database. Costs nothing and keeps
  // a scanner spraying random bearer tokens from generating query load.
  if (!key.startsWith("pcsk_")) {
    recordAuthFailure(req)
    return fail(401, "invalid_api_key")
  }

  const admin: SupabaseClient<any> = createServiceClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { data, error } = await admin.rpc("tenant_api_key_verify", { p_key: key })
  if (error) return fail(500, "verification_failed", error.message)

  // Zero rows is the ONLY success-shaped failure: revoked, expired, and unknown keys all land here,
  // and they are reported identically on purpose — distinguishing them tells an attacker which of
  // their guesses was once real.
  const row = Array.isArray(data) ? data[0] : data
  if (!row?.tenant_id) {
    // A rejected KEY is the attempt worth counting. A valid key that merely lacks a scope is a
    // misconfigured client, not a guess, and throttling it would punish the honest case.
    recordAuthFailure(req)
    // The shared bucket is what actually stops a spray — the in-memory map above is per isolate and
    // does not accumulate under real traffic. Charged here, on the rejection path only, so a
    // successful call never pays for it.
    const exhausted = await recordAuthFailureShared(req, admin)
    if (exhausted) {
      return { failed: tooManyAttempts({ allowed: false, remaining: 0, retryAfterSec: 60 }) as NextResponse }
    }
    return fail(401, "invalid_api_key")
  }

  const scopes: string[] = row.scopes ?? []
  if (!scopes.includes(scope)) {
    // 403, not 401: the credential is valid, the permission is not. Retrying with the same key will
    // never help, and saying so is what stops a client looping on it.
    return fail(403, "insufficient_scope", `this key does not carry '${scope}'`)
  }

  // Token bucket, per tenant. The management API is for automation, so the failure mode to guard
  // against is a loop, not a human clicking fast: 120 requests with 1/s refill absorbs a burst and
  // then throttles to a rate a runaway script cannot outrun.
  const { data: allowed } = await admin.rpc("rate_limit_check", {
    p_tenant_id: row.tenant_id,
    p_bucket_name: "management_api",
    p_max_tokens: 120,
    p_refill_per_sec: 1,
  })
  if (allowed === false) return fail(429, "rate_limited")

  return { tenantId: row.tenant_id, keyId: row.key_id, scopes, admin }
}

/** Audit one management-API action against the key that performed it. */
export async function auditApiAction(
  ctx: ApiKeyContext,
  action: string,
  resource: string,
  after?: Record<string, unknown>,
) {
  await ctx.admin
    .rpc("audit_log_emit", {
      p_tenant_id: ctx.tenantId,
      p_actor_user_id: null,
      p_actor_type: "api_key",
      p_action: action,
      p_resource: resource,
      p_before: null,
      p_after: { ...(after ?? {}), key_id: ctx.keyId },
    })
    // An audit write must never convert a successful operation into a failed response, but it must
    // not vanish either — the server log is the backstop when the audit table itself is the problem.
    .then(
      () => {},
      (e: unknown) => console.error("audit_log_emit failed", action, e),
    )
}
