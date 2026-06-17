// supabase/functions/_shared/rate-limit.ts
// Per-tenant + per-IP token-bucket rate limiter wrapping the rate_limit_check RPC.
//
// Phase 4 of paycraft-v2-production-readiness — adds per-IP fallback for
// pre-auth webhook handlers + response headers (X-RateLimit-*) so clients can
// pace themselves without hitting 429s.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"

export class RateLimitError extends Error {
  constructor(public bucket: string) {
    super(`rate_limit:${bucket}`)
    this.name = "RateLimitError"
  }
}

export interface RateLimitOutcome {
  ok: boolean
  remaining: number
  resetAt: number  // epoch seconds
  bucket: string
}

/**
 * Per-tenant rate limit with per-IP fallback when tenantId is null.
 * Falls back to `ip:<address>` bucket when the caller cannot resolve a tenant
 * yet (e.g. webhook handler before signature verification).
 *
 * Returns an outcome object with X-RateLimit-* header values; callers SHOULD
 * propagate `rateLimitHeaders(outcome)` into their 200 response so clients
 * can pace themselves before hitting 429s.
 *
 * Fail-open semantics: on rpc error the call still succeeds. Better to
 * over-serve than to outage on rate-limit infra.
 */
export async function requireRateLimit(
  supabase: SupabaseClient,
  tenantId: string | null,
  ipAddress: string,
  bucket: string,
  maxTokens: number,
  refillPerSec: number,
): Promise<RateLimitOutcome> {
  const key = tenantId ?? `ip:${ipAddress}`
  const { data, error } = await supabase.rpc("rate_limit_check", {
    p_tenant_id: key,
    p_bucket_name: bucket,
    p_max_tokens: maxTokens,
    p_refill_per_sec: refillPerSec,
  })
  if (error) {
    return { ok: true, remaining: maxTokens, resetAt: Math.floor(Date.now() / 1000) + 60, bucket }
  }
  const allowed =
    data === true ||
    (typeof data === "object" && data !== null && (data as { allowed?: boolean }).allowed === true)
  const remaining =
    (typeof data === "object" && data !== null && typeof (data as { remaining?: number }).remaining === "number")
      ? (data as { remaining: number }).remaining
      : allowed ? maxTokens - 1 : 0
  const resetAt =
    (typeof data === "object" && data !== null && typeof (data as { reset_at?: number }).reset_at === "number")
      ? (data as { reset_at: number }).reset_at
      : Math.floor(Date.now() / 1000) + 60
  if (!allowed) throw new RateLimitError(bucket)
  return { ok: true, remaining, resetAt, bucket }
}

export function rateLimitHeaders(outcome: RateLimitOutcome): Record<string, string> {
  return {
    "X-RateLimit-Remaining": String(outcome.remaining),
    "X-RateLimit-Reset": String(outcome.resetAt),
    "X-RateLimit-Bucket": outcome.bucket,
  }
}

export function rateLimitResponse(e: RateLimitError): Response {
  return new Response(
    JSON.stringify({ error: "rate_limited", bucket: e.bucket }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": "60",
        "X-RateLimit-Remaining": "0",
        "X-RateLimit-Reset": String(Math.floor(Date.now() / 1000) + 60),
        "X-RateLimit-Bucket": e.bucket,
      },
    },
  )
}
