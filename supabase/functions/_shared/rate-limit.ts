// supabase/functions/_shared/rate-limit.ts
// Per-tenant token-bucket rate limiter wrapping the rate_limit_check RPC.

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2"

export class RateLimitError extends Error {
  constructor(public bucket: string) {
    super(`rate_limit:${bucket}`)
    this.name = "RateLimitError"
  }
}

export async function requireRateLimit(
  supabase: SupabaseClient,
  tenantId: string,
  bucket: string,
  maxTokens: number,
  refillPerSec: number,
): Promise<void> {
  const { data, error } = await supabase.rpc("rate_limit_check", {
    p_tenant_id: tenantId,
    p_bucket_name: bucket,
    p_max_tokens: maxTokens,
    p_refill_per_sec: refillPerSec,
  })
  if (error) throw error
  if (!data) throw new RateLimitError(bucket)
}

export function rateLimitResponse(e: RateLimitError): Response {
  return new Response(
    JSON.stringify({ error: "rate_limited", bucket: e.bucket }),
    {
      status: 429,
      headers: {
        "content-type": "application/json",
        "retry-after": "60",
      },
    },
  )
}
