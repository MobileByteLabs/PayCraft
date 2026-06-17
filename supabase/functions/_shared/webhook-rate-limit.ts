// supabase/functions/_shared/webhook-rate-limit.ts
//
// Phase 4 of paycraft-v2-production-readiness — single front-door wrapper for
// every provider webhook handler. Sheds abusive bursts BEFORE we run signature
// verification (which is the expensive part). The wrapper:
//
//   1. Extracts the caller IP (cf-connecting-ip → x-forwarded-for → x-real-ip).
//   2. Calls `requireRateLimit(...)` with per-IP key, fail-open on RPC error.
//   3. On 429 throw → returns the canonical `rateLimitResponse(e)` (carries
//      X-RateLimit-* headers + Retry-After).
//   4. On allow → calls the inner handler, then merges the X-RateLimit-* headers
//      into its response so well-behaved clients can pace themselves.
//
// The bucket name encodes the provider so per-provider buckets stay isolated
// (one noisy Stripe burst doesn't burn the Razorpay budget). Defaults follow
// the published SLA: 60 req/60s sustained, allow short 60-burst.

import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.39.3?target=deno"
import {
  RateLimitError,
  rateLimitHeaders,
  rateLimitResponse,
  requireRateLimit,
} from "./rate-limit.ts"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "http://kong:8000"
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""

let _client: SupabaseClient | null = null
function client(): SupabaseClient | null {
  if (!SERVICE_ROLE) return null
  if (_client) return _client
  _client = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return _client
}

function extractIp(req: Request): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    req.headers.get("x-real-ip") ??
    "unknown"
  )
}

export interface WebhookRateLimitConfig {
  bucket: string         // e.g. "webhook:stripe"
  maxTokens?: number     // default 60
  refillPerSec?: number  // default 1 (sustained 60/min)
}

/**
 * Wrap a webhook handler with per-IP rate limiting. Use exactly like:
 *
 *   serve(withWebhookRateLimit({ bucket: "webhook:stripe" }, async (req) => {
 *     // existing handler body, unchanged
 *   }))
 *
 * If the rate-limit infrastructure is unavailable (no service role, RPC
 * error), the wrapper degrades to fail-open — the handler still runs.
 */
export function withWebhookRateLimit(
  config: WebhookRateLimitConfig,
  handler: (req: Request) => Promise<Response>,
): (req: Request) => Promise<Response> {
  const maxTokens = config.maxTokens ?? 60
  const refillPerSec = config.refillPerSec ?? 1

  return async (req: Request): Promise<Response> => {
    const supabase = client()
    if (!supabase) {
      // No service role available — call handler directly (fail-open).
      return handler(req)
    }

    const ip = extractIp(req)
    try {
      const outcome = await requireRateLimit(
        supabase,
        null,                // tenantId resolved AFTER signature verification
        ip,
        config.bucket,
        maxTokens,
        refillPerSec,
      )
      const response = await handler(req)
      // Merge X-RateLimit-* headers into the inner response. Don't clobber
      // existing headers (e.g. Content-Type from the inner handler).
      const headers = new Headers(response.headers)
      for (const [k, v] of Object.entries(rateLimitHeaders(outcome))) {
        if (!headers.has(k)) headers.set(k, v)
      }
      return new Response(response.body, { status: response.status, headers })
    } catch (e) {
      if (e instanceof RateLimitError) return rateLimitResponse(e)
      // Any other thrown error → re-throw to preserve the existing error
      // surface (Deno's serve wrapper logs + returns 500).
      throw e
    }
  }
}
