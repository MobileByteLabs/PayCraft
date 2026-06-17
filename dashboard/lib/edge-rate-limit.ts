// dashboard/lib/edge-rate-limit.ts
// Phase 4 of paycraft-v2-production-readiness — per-IP token-bucket rate
// limiter that runs in Next.js middleware (Vercel edge runtime).
//
// Why edge-local + not Supabase: the Postgres-backed rate_limit_check RPC
// requires a Supabase client + service_role key, which the edge runtime
// cannot safely hold. So we run an in-process bucket per Vercel region.
// That is acceptable for "shed abusive bursts before they hit our app code"
// — the authoritative tenant-bound rate-limit still runs server-side via
// supabase/functions/_shared/rate-limit.ts (webhook handlers + Edge Functions).
//
// Bucket: per-IP, 60 requests / 60 seconds (1 req/sec sustained, 60-burst).
// Sliding window via timestamp pruning to keep memory bounded.

const WINDOW_MS = 60_000
const MAX_REQUESTS = 60

const buckets = new Map<string, number[]>()

export interface EdgeRateLimitOutcome {
  ok: boolean
  remaining: number
  resetAt: number // epoch seconds
}

export function checkEdgeRateLimit(ip: string): EdgeRateLimitOutcome {
  const now = Date.now()
  const windowStart = now - WINDOW_MS

  const recent = (buckets.get(ip) ?? []).filter((ts) => ts > windowStart)

  if (recent.length >= MAX_REQUESTS) {
    const resetAt = Math.ceil((recent[0] + WINDOW_MS) / 1000)
    buckets.set(ip, recent)
    return { ok: false, remaining: 0, resetAt }
  }

  recent.push(now)
  buckets.set(ip, recent)

  return {
    ok: true,
    remaining: MAX_REQUESTS - recent.length,
    resetAt: Math.ceil((now + WINDOW_MS) / 1000),
  }
}

export function rateLimitHeaders(outcome: EdgeRateLimitOutcome): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(MAX_REQUESTS),
    "X-RateLimit-Remaining": String(outcome.remaining),
    "X-RateLimit-Reset": String(outcome.resetAt),
  }
}

export function extractIp(headers: Headers): string {
  return (
    headers.get("cf-connecting-ip") ??
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    headers.get("x-real-ip") ??
    "unknown"
  )
}
