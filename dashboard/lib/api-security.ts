import { NextResponse } from "next/server"
import { extractIp } from "@/lib/edge-rate-limit"

/**
 * Transport-level hardening for the machine API.
 *
 * Separate from `api-key-auth`, which answers "who is this and may they do this". This file answers
 * the questions that apply to every response regardless of the answer: what a browser is allowed to
 * do with it, what a proxy may cache, and how many times a stranger may guess.
 */

/**
 * Headers applied to every API response, including failures.
 *
 * `no-store` matters more than it looks: these responses carry a tenant's billing state, and a
 * CDN or corporate proxy that cached one would serve it to the next caller. The default for an
 * un-hinted 200 is "heuristically cacheable", so silence here is not neutral.
 *
 * `nosniff` stops a JSON error body being re-interpreted as HTML or script if one is ever rendered
 * somewhere it should not be. `frame-ancestors 'none'` and `X-Frame-Options` cost nothing on a JSON
 * endpoint and close clickjacking against the HTML pages served from the same host.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "geolocation=(), camera=(), microphone=(), payment=()",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Cache-Control": "no-store",
}

/**
 * Headers for the PUBLIC documentation pages.
 *
 * The API policy would break them: the portal and Swagger UI need their own styles and, for
 * Swagger, a script and a stylesheet from jsDelivr. They are deliberately cacheable — a docs page
 * is not tenant data — and they still get nosniff, HSTS and frame-denial.
 */
export const DOCS_HEADERS: Record<string, string> = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy":
    "default-src 'none'; " +
    "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; " +
    "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'; " +
    "img-src 'self' data:; font-src 'self' data:; " +
    "connect-src 'self'; frame-ancestors 'none'; base-uri 'none'",
}

export function withSecurityHeaders(res: Response, headers = SECURITY_HEADERS): Response {
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v)
  return res
}

// ── failed-authentication throttling ──────────────────────────────────────────────────────────
//
// The gap this closes: `requireApiKey` returns 401 BEFORE the per-tenant token bucket, because an
// unknown key has no tenant to charge. So every rejected attempt was free, and a key could be
// sprayed indefinitely. Measured on production: eight bad keys, eight 401s, no throttling.
//
// TWO LAYERS, AND ONLY ONE OF THEM ACTUALLY ENFORCES.
//
//   1. An in-memory map, per isolate. Free, and catches a burst that happens to land on one
//      isolate. It is NOT the enforcement: measured against production, 26 consecutive bad keys
//      produced 26 × 401 and never a 429, because Cloudflare spreads requests across isolates and
//      a per-isolate counter never accumulates. Kept as a cheap first filter, not relied upon.
//
//   2. A shared bucket in Postgres (migration 145), consulted on REJECTION only. This is what
//      actually stops sustained spraying: one bucket, every isolate, 20 failures per source with a
//      slow refill. A successful call never touches it, so the honest path pays nothing.
//
// The natural home for this is a Cloudflare WAF rate-limiting rule, in front of the Worker. The
// deploy token has no WAF permission, so that needs a human; until then layer 2 is the enforcement.
//
// A 32-byte key is not guessable by brute force, and no rate limit makes it so — the entropy is
// what protects the data. This stops the cheap attacks: replaying a leaked key list at line rate,
// and using the endpoint as free compute.

const FAIL_WINDOW_MS = 60_000
const FAIL_MAX = 20

const failures = new Map<string, number[]>()

export interface ThrottleOutcome {
  allowed: boolean
  remaining: number
  retryAfterSec: number
}

/** Layer 1. Side-effect free: asking must never consume budget, or a busy client throttles itself. */
export function checkAuthAttempts(req: Request): ThrottleOutcome {
  const ip = extractIp(req.headers)
  const now = Date.now()
  const recent = (failures.get(ip) ?? []).filter((t) => now - t < FAIL_WINDOW_MS)
  if (recent.length) failures.set(ip, recent)
  else failures.delete(ip)

  const allowed = recent.length < FAIL_MAX
  return {
    allowed,
    remaining: Math.max(0, FAIL_MAX - recent.length),
    retryAfterSec: allowed ? 0 : Math.ceil((FAIL_WINDOW_MS - (now - recent[0])) / 1000),
  }
}

/** Call ONLY on a rejected attempt. */
export function recordAuthFailure(req: Request): void {
  const ip = extractIp(req.headers)
  const now = Date.now()
  const recent = (failures.get(ip) ?? []).filter((t) => now - t < FAIL_WINDOW_MS)
  recent.push(now)
  failures.set(ip, recent)

  // Unbounded growth would be a memory-exhaustion vector of its own; sweep opportunistically.
  if (failures.size > 5_000) {
    for (const [k, v] of failures) {
      if (!v.some((t) => now - t < FAIL_WINDOW_MS)) failures.delete(k)
    }
  }
}

/**
 * Hash the source address before it leaves the Worker.
 *
 * The server needs to know that the same source is repeating itself, never who it is. Storing raw
 * addresses would make the throttle table a privacy liability for no operational gain. The salt is
 * the service-role key — already a secret, already present, and it stops the hash being reversible
 * by anyone who obtains a dump and a list of candidate addresses.
 */
async function hashIp(req: Request): Promise<string> {
  const ip = extractIp(req.headers)
  if (!ip) return ""
  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "paycraft"
  const bytes = new TextEncoder().encode(`${salt}:${ip}`)
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * Layer 2 — charge the SHARED bucket for a rejected attempt.
 *
 * Returns true when the source has exhausted its budget, so the caller can answer 429 instead of
 * another 401. Fails OPEN on any error: a throttle that cannot reach the database must not become
 * an outage for every legitimate caller.
 */
export async function recordAuthFailureShared(
  req: Request,
  // Structurally typed against what is actually used, not the full SupabaseClient: the builder it
  // returns is thenable rather than a Promise, and naming the concrete type here would couple this
  // helper to a client version for no benefit.
  admin: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown }> },
): Promise<boolean> {
  try {
    const ip_hash = await hashIp(req)
    if (!ip_hash) return false
    const { data } = await admin.rpc("auth_attempt_record", { p_ip_hash: ip_hash })
    return data === false
  } catch {
    return false
  }
}

/**
 * Per-source limit on EVERY request, not only failures.
 *
 * This exists because the edge cannot provide it. `api.paycraft` and `mcp.paycraft` are Pages
 * custom domains, and a zone rate-limiting rule pointed at them does not fire — verified by
 * lowering the threshold to its floor (5 per 10s) and watching 30 concurrent requests all return
 * 200 with zero Cloudflare blocks. Custom firewall rules DO reach those hosts (a probe rule
 * returned 403 at once), but they cannot express a rate. So the application is the only place this
 * limit can actually live on this plan.
 *
 * 600 tokens refilling at 10/second: generous enough that no legitimate client notices, tight
 * enough that a runaway loop or a scraper is bounded. Charged BEFORE authentication, so an
 * unauthenticated flood against the public docs costs the attacker the same as anyone else.
 *
 * Fails OPEN. A limiter that cannot reach the database must not take the API down with it.
 */
export async function requestThrottleExceeded(
  req: Request,
  admin: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown }> },
): Promise<boolean> {
  try {
    const ip_hash = await hashIp(req)
    if (!ip_hash) return false
    const { data } = await admin.rpc("request_throttle_check", { p_ip_hash: ip_hash })
    return data === false
  } catch {
    return false
  }
}

export function tooManyRequests(): Response {
  return withSecurityHeaders(
    NextResponse.json(
      { error: "rate_limited", detail: "Too many requests from this address. Slow down." },
      { status: 429, headers: { "Retry-After": "10" } },
    ),
  )
}

export function tooManyAttempts(outcome: ThrottleOutcome): Response {
  return withSecurityHeaders(
    NextResponse.json(
      {
        error: "too_many_auth_attempts",
        detail: "Too many failed authentication attempts from this address. Slow down.",
      },
      { status: 429, headers: { "Retry-After": String(outcome.retryAfterSec) } },
    ),
  )
}

/**
 * Reject an oversized body before parsing it.
 *
 * Every write this API accepts is a handful of fields. Without a cap, `await req.json()` will
 * happily buffer whatever arrives, which turns a public endpoint into a memory amplifier.
 */
/**
 * A database error, rendered safely.
 *
 * Five endpoints passed `error.message` straight to the caller. A Postgres message is not a safe
 * string: it routinely carries schema and constraint names, and it carries ROW VALUES —
 * `duplicate key value violates unique constraint … Key (email)=(someone@example.com) already
 * exists` hands another tenant's customer email to whoever triggered it. One was observed in this
 * project quoting an entire failing row.
 *
 * It is also invisible to a source scan: the leak is assembled at runtime from a value the code
 * never names. So the rule is structural rather than textual — a database error NEVER reaches a
 * caller. The caller gets a stable code it can branch on; the operator gets the message in the log.
 */
export function queryFailed(where: string, error: { message?: string; code?: string } | null): Response {
  console.error(`query_failed at ${where}: ${error?.code ?? "?"} ${error?.message ?? "unknown"}`)
  return withSecurityHeaders(
    NextResponse.json(
      {
        error: "query_failed",
        // Deliberately not `error.message`. A stable code is what a client can act on anyway.
        detail: "The request could not be completed. If this persists, contact support.",
      },
      { status: 500 },
    ),
  )
}

export const MAX_BODY_BYTES = 64 * 1024

export function bodyTooLarge(req: Request): Response | null {
  const declared = Number(req.headers.get("content-length") ?? 0)
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    return withSecurityHeaders(
      NextResponse.json(
        { error: "payload_too_large", detail: `Body must be ${MAX_BODY_BYTES} bytes or fewer.` },
        { status: 413 },
      ),
    )
  }
  return null
}
