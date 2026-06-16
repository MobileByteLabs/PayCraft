// supabase/functions/coupon-validate/index.ts
//
// Public coupon validation for the PayCraft SDK.
//
// POST /functions/v1/coupon-validate
// {
//   "apiKey":     "pk_live_…",
//   "code":       "WELCOME25",
//   "product_id": "uuid"
// }
//
// Response (200): CouponDto if redeemable
// Response (404): { "error": "invalid_code" } when no match
// Response (401): when apiKey is bogus
//
// The SDK calls this from `PayCraft.applyCoupon(code, productId)` to surface the
// discount preview in the paywall BEFORE the customer commits. Actual redemption
// happens later via Stripe Checkout — this endpoint never mutates state.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import {
  RateLimitError,
  rateLimitResponse,
  requireRateLimit,
} from "../_shared/rate-limit.ts"

serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 })
  }

  const body = await req.json().catch(() => null) as {
    apiKey?: string
    code?: string
    product_id?: string
  } | null

  if (!body?.apiKey || !body.code || !body.product_id) {
    return jsonResponse(400, { error: "missing_params — need apiKey, code, product_id" })
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )

  // 1. Resolve tenant from API key.
  const { data: tenantId, error: resolveErr } = await supabase.rpc(
    "resolve_tenant",
    { p_api_key: body.apiKey },
  )
  if (resolveErr || !tenantId) {
    return jsonResponse(401, { error: "invalid_apiKey" })
  }

  // 2. Per-tenant rate limit (60 attempts burst, 1 refill/sec) — protects
  //    against code-guessing brute force.
  try {
    await requireRateLimit(supabase, tenantId, "coupon_validate", 60, 1)
  } catch (e) {
    if (e instanceof RateLimitError) return rateLimitResponse(e)
    throw e
  }

  // 3. Validate via SECURITY DEFINER RPC — handles all the active / expired /
  //    max-redemptions / applies-to-product logic in SQL.
  const { data: rows, error: rpcErr } = await supabase.rpc(
    "tenant_coupon_validate",
    {
      p_tenant_id: tenantId,
      p_code: body.code.trim().toUpperCase(),
      p_product_id: body.product_id,
    },
  )
  if (rpcErr) {
    return jsonResponse(500, { error: rpcErr.message })
  }
  if (!rows || (Array.isArray(rows) && rows.length === 0)) {
    return jsonResponse(404, { error: "invalid_code" })
  }

  const row = Array.isArray(rows) ? rows[0] : rows
  return jsonResponse(200, {
    id: row.id,
    code: row.code,
    name: row.name,
    percent_off: row.percent_off,
    duration: row.duration,
    duration_in_months: row.duration_in_months,
    redeem_by: row.redeem_by,
  })
})

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}
