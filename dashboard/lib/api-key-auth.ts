import { NextResponse } from "next/server"
import { createClient as createServiceClient, type SupabaseClient } from "@supabase/supabase-js"
import {
  SECURITY_HEADERS,
  checkAuthAttempts,
  recordAuthFailure,
  recordAuthFailureShared,
  requestThrottleExceeded,
  tooManyAttempts,
  tooManyRequests,
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
 * 1. REACH COMES FROM THE KEY. A REQUEST MAY ONLY NARROW WITHIN IT, NEVER WIDEN IT.
 *    `verify` returns the set of tenants a key reaches. A request may SELECT one of them; it can
 *    never introduce one. If the payload could widen reach, any valid key would be a key to every
 *    tenant — the property this file exists to hold.
 *
 *    Originally stated as "identity comes from the key, never from the request", because every key
 *    reached exactly one tenant and routes took no tenant parameter at all. Migration 150 added
 *    ACCOUNT-scoped keys, which reach every app their owner administers, so a request has to be
 *    able to say which app it means. That is a narrowing, and the rule is extended rather than
 *    relaxed:
 *      • app-scoped key   → the set is its one tenant. A request naming a DIFFERENT tenant is 403,
 *                           so the original guarantee is untouched for every existing key.
 *      • account-scoped   → the set is resolved LIVE from tenant_admins at verify time. A request
 *                           naming a tenant outside it is 403; naming NONE is 400, never a guess.
 *
 *    Refusing the no-tenant case matters: picking one silently is the same defect class as
 *    `rotate_api_key`, which took an arbitrary row from a multi-row SELECT and could rotate the
 *    wrong app's live credential.
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

/**
 * Scopes the API recognises. Mirrors the CHECK constraint in migrations 136 + 150 — keep in step.
 *
 * A scope absent from the DB constraint cannot be granted, so adding one here alone is inert; a
 * scope absent HERE cannot be demanded by a route, so adding one there alone is unreachable.
 */
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
  // Added by migration 150 — the write side an end-to-end onboarding needs. Separate from the
  // read scopes so a reporting token can never provision an app or rotate a credential.
  | "products:write"
  | "paywall:write"
  | "providers:write"
  | "apps:read"
  | "apps:provision"
  | "keys:rotate"

export interface ApiKeyContext {
  /**
   * The tenant RESOLVED for this request — always a concrete id, never null.
   *
   * For an app-scoped key it is the key's own tenant. For an account-scoped key it is the one the
   * request named, already validated against the key's reachable set. Routes use this exactly as
   * before and cannot tell the two apart, which is the point: the widening question is settled
   * here, once.
   */
  tenantId: string
  keyId: string
  scopes: string[]
  /** True when this key reaches more than its own app (migration 150). */
  accountScoped: boolean
  /** Every tenant this key may reach. One element for an app key. */
  reachableTenantIds: string[]
  /** Service-role client. RLS does not apply to it, so every query MUST filter by `tenantId`. */
  admin: SupabaseClient<any>
}

/** A failed authentication, already rendered. Callers return it unchanged. */
export type ApiKeyFailure = { failed: NextResponse }

export function isFailure(v: ApiKeyContext | ApiKeyFailure): v is ApiKeyFailure {
  return (v as ApiKeyFailure).failed !== undefined
}

/**
 * The tenant a request is asking to act on, read from `?tenant_id=`.
 *
 * Pass the result straight to `requireApiKey`. It is a REQUEST, not a grant: an app-scoped key
 * naming anything but its own tenant is refused, and an account-scoped key naming a tenant outside
 * its live reach is refused. Returning it here rather than letting each route parse the query keeps
 * one spelling of the parameter, so a route cannot accidentally read a different field and bypass
 * the check.
 */
export function requestedTenant(req: Request): string | null {
  try {
    return new URL(req.url).searchParams.get("tenant_id")
  } catch {
    return null
  }
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
  /**
   * The tenant this request means. REQUIRED when the key is account-scoped, ignored-unless-equal
   * when it is app-scoped. Routes that serve account keys read it from the payload or query and
   * pass it here; this function decides whether the key may reach it.
   */
  requestedTenantId?: string | null,
): Promise<ApiKeyContext | ApiKeyFailure> {
  if (!SUPABASE_URL || !SERVICE_ROLE) {
    // Detailed in the LOG, generic in the RESPONSE. Naming the variable matters for whoever is
    // debugging — a bare "server error" is indistinguishable from an outage, and that ambiguity
    // cost this codebase a day. But this 500 is reachable WITHOUT authenticating, so naming it in
    // the body told any anonymous caller which infrastructure variable we run on. The operator
    // gets the name; the internet gets the fact.
    console.error("api-key-auth: SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL is not set")
    return fail(500, "server_misconfigured", "The API is not correctly configured. Contact support.")
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

  // Per-source ceiling on every request, charged before the key is looked up. The edge cannot do
  // this for Pages-served hostnames (see api-security), so it is enforced here or nowhere.
  if (await requestThrottleExceeded(req, admin)) {
    return { failed: tooManyRequests() as NextResponse }
  }

  const { data, error } = await admin.rpc("tenant_api_key_verify", { p_key: key })
  if (error) return fail(500, "verification_failed", error.message)

  // Zero rows is the ONLY success-shaped failure: revoked, expired, and unknown keys all land here,
  // and they are reported identically on purpose — distinguishing them tells an attacker which of
  // their guesses was once real.
  const row = Array.isArray(data) ? data[0] : data
  // Presence of a KEY ID is the success test, not tenant_id. An account-scoped key deliberately
  // returns tenant_id = NULL (migration 150), and testing the old field would have rendered every
  // valid account key a 401 — failing closed, but silently and confusingly.
  if (!row?.key_id) {
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

  const accountScoped: boolean = row.account_scoped === true
  const reachable: string[] = (row.tenant_ids ?? []).filter(Boolean)

  // ── Resolve WHICH tenant this request acts on, within what the key already reaches ──────────
  let tenantId: string
  if (!accountScoped) {
    tenantId = row.tenant_id
    // An app key naming a different tenant is the exact attack rule 1 exists to stop. Refused even
    // though the route would have used the key's own tenant anyway — a request that tried to widen
    // reach is a bug or an probe, and silently succeeding teaches the caller it worked.
    if (requestedTenantId && requestedTenantId !== tenantId) {
      return fail(403, "tenant_not_reachable", "this key is scoped to a single app")
    }
  } else {
    if (!requestedTenantId) {
      // NEVER pick one. Same defect class as rotate_api_key taking an arbitrary row.
      //
      // But DO name them. A bare count is a dead end: the caller is told to choose and given
      // nothing to choose from, so the only way forward was a direct psql session — which is the
      // superuser path this API exists to replace. Listing the tenants the key ALREADY reaches is
      // not enumeration: the holder is authorized for every one of them. That is precisely why the
      // 403 below stays opaque (it would reveal an app OUTSIDE the key's reach) while this does not.
      return fail(
        400,
        "tenant_required",
        `this key reaches ${reachable.length} app(s); name the one you mean via tenant_id: ${reachable.join(", ")}`,
      )
    }
    if (!reachable.includes(requestedTenantId)) {
      // Indistinguishable from "app does not exist" on purpose: telling a caller that an app
      // exists but is out of reach enumerates the account's apps.
      return fail(403, "tenant_not_reachable")
    }
    tenantId = requestedTenantId
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
    // Per RESOLVED tenant. Budgeting an account key per-key instead would let one busy app starve
    // the others that share it.
    p_tenant_id: tenantId,
    p_bucket_name: "management_api",
    p_max_tokens: 120,
    p_refill_per_sec: 1,
  })
  if (allowed === false) return fail(429, "rate_limited")

  return {
    tenantId,
    keyId: row.key_id,
    scopes,
    accountScoped,
    reachableTenantIds: accountScoped ? reachable : [tenantId],
    admin,
  }
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
