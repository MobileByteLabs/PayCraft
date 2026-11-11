// supabase/functions/winback/index.ts
//
// Exit-survey answers → win-back decision (paycraft-paywall-analytics, GOAL D3 / D6 / D7).
//
// POST /functions/v1/winback?apiKey=pk_…
// { "apiKey", "deviceRef", "deviceToken"?, "reasonCode", "step", "platform", "sku"?, "freeText"?, "mode"? }
//
// 200 { action: "offer", offer: { id, percentOff, duration, durationInMonths?, expiresAt, lanes } }
//   | { action: "message", message } | { action: "none" }
// 400 unknown_reason / bad_body · 401 invalid_apiKey · 429
//
// Records the answer (free text only for a reason that asks for it — stored here, never sent to analytics),
// then applies the tenant's rule for that reason. An offer is bound to the buyer (account hash, else device
// hash), at most once per buyer per coupon (DB UNIQUE), expires after the tenant's offer_hours, and lists the
// lanes where its discount exists (Stripe / Razorpay / the Play offer id / the App Store offer id).

import { serve } from "https://deno.land/std@0.208.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.106.1"
import { preflight, withCors } from "../_shared/cors.ts"
import { redeemableNow } from "../_shared/exit-survey.ts"
import { recordedCountry } from "../_shared/geo.ts"
import { RateLimitError, rateLimitResponse, requireRateLimit } from "../_shared/rate-limit.ts"
import { buyerRef, lanesFor, type OfferCoupon } from "../_shared/winback-offer.ts"
import { signPromotionalOffer } from "../_shared/appstore-offer.ts"

const CODE = /^[a-z][a-z_]{0,30}$/
const PLATFORMS = new Set(["android", "ios", "web", "desktop"])

const json = (status: number, body: unknown) =>
  withCors(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }))

const str = (v: unknown, max: number): string | null => (typeof v === "string" && v.length > 0 ? v.slice(0, max) : null)

serve(async (req: Request): Promise<Response> => {
  const pre = preflight(req)
  if (pre) return pre
  if (req.method !== "POST") return json(405, { error: "method_not_allowed" })

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return json(400, { error: "bad_body" })
  const apiKey = str(body.apiKey, 200) ?? new URL(req.url).searchParams.get("apiKey") ?? ""
  const reasonCode = str(body.reasonCode, 31)
  const step = str(body.step, 31)
  const platform = str(body.platform, 10)
  if (!reasonCode || !CODE.test(reasonCode) || !step || !CODE.test(step) || !platform || !PLATFORMS.has(platform)) {
    return json(400, { error: "bad_body" })
  }

  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!)
  const { data: tenantId, error: resolveErr } = await supabase.rpc("resolve_tenant", { p_api_key: apiKey })
  if (resolveErr || !tenantId) return json(401, { error: "invalid_apiKey" })

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() ?? "unknown"
  try {
    await requireRateLimit(supabase, tenantId, ip, "winback", 30, 0.5)
  } catch (e) {
    if (e instanceof RateLimitError) return withCors(rateLimitResponse(e))
    throw e
  }

  const { data: survey } = await supabase.from("tenant_exit_survey")
    .select("enabled,reasons,offer_hours").eq("tenant_id", tenantId).maybeSingle()
  const reasons = (survey?.reasons ?? []) as Array<{ code: string; enabled?: boolean; action?: string; message?: string; coupon_id?: string; free_text?: boolean }>
  const reason = reasons.find((r) => r?.code === reasonCode && r.enabled !== false)
  if (!survey?.enabled || !reason) return json(400, { error: "unknown_reason" })

  // The buyer: their account when the device token is signed in, else the device.
  const deviceRef = str(body.deviceRef, 100)
  let email: string | null = null
  const token = str(body.deviceToken, 200)
  if (token) {
    const { data: dev } = await supabase.from("registered_devices").select("email")
      .eq("device_token", token).eq("tenant_id", tenantId).maybeSingle()
    email = dev?.email ?? null
  }
  const userRef = await buyerRef(tenantId, email, deviceRef)
  const mode = (req.headers.get("x-paycraft-mode") ?? str(body.mode, 4) ?? "").toLowerCase() === "test" ? "test" : "live"
  const sku = str(body.sku, 100)

  await supabase.from("exit_survey_responses").insert({
    tenant_id: tenantId, user_ref: userRef, device_ref: deviceRef, step, reason_code: reasonCode,
    free_text: reason.free_text ? str(body.freeText, 500) : null,
    platform, country: recordedCountry(req), sku, mode,
  })

  if (reason.action === "message" && reason.message) return json(200, { action: "message", message: reason.message })
  if (reason.action !== "offer" || !reason.coupon_id || !userRef) return json(200, { action: "none" })

  const { data: coupon } = await supabase.from("tenant_coupons")
    .select("id,percent_off,duration,duration_in_months,active,redeem_by,max_redemptions,times_redeemed,stripe_coupon_id,stripe_promotion_code_id,razorpay_offer_id,googleplay_offer_ids,appstore_offer_ids")
    .eq("tenant_id", tenantId).eq("id", reason.coupon_id).maybeSingle()
  if (!coupon || !redeemableNow(coupon as OfferCoupon)) return json(200, { action: "none" })

  const expiresAt = new Date(Date.now() + Number(survey.offer_hours ?? 48) * 3600 * 1000).toISOString()
  const { data: offer, error: offerErr } = await supabase.from("winback_offers")
    .insert({ tenant_id: tenantId, user_ref: userRef, coupon_id: coupon.id, reason_code: reasonCode, sku, expires_at: expiresAt })
    .select("id,expires_at").single()
  // A unique violation means this buyer already had this offer (GOAL D7): nothing more to give.
  if (offerErr || !offer) return json(200, { action: "none" })

  let product: { id: string; app_store_product_id: string | null } | null = null
  if (sku) {
    const { data: p } = await supabase.from("tenant_products").select("id,app_store_product_id").eq("tenant_id", tenantId).eq("sku", sku).maybeSingle()
    product = p ?? null
  }
  const lanes: Record<string, unknown> = lanesFor(coupon as OfferCoupon, product?.id ?? null)
  // iOS: StoreKit applies a promotional offer only with a signature from the app's In-App Purchase key, over
  // this product, offer and the purchase's appAccountToken. No key / no App Store product → no App Store lane.
  lanes.app_store = platform === "ios" && lanes.app_store && product?.app_store_product_id
    ? await signedAppStoreOffer(supabase, tenantId, product.app_store_product_id, String(lanes.app_store), str(body.appAccountToken, 36))
    : null
  return json(200, {
    action: "offer",
    offer: {
      id: offer.id,
      percentOff: coupon.percent_off,
      duration: coupon.duration ?? "once",
      ...(coupon.duration_in_months != null ? { durationInMonths: coupon.duration_in_months } : {}),
      expiresAt: offer.expires_at,
      lanes,
    },
  })
})

/** The App Store lane of an offer: Apple's signed promotional offer, or null when the tenant's key is not set up. */
async function signedAppStoreOffer(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  tenantId: string,
  productId: string,
  offerId: string,
  appAccountToken: string | null,
) {
  try {
    const { data } = await supabase.rpc("tenant_providers_decrypt_store_key", { p_tenant_id: tenantId, p_provider: "app_store" })
      .maybeSingle()
    const cfg = (data?.config ?? {}) as Record<string, string>
    if (!data?.credential || !cfg.key_id || !cfg.bundle_id) return null
    return await signPromotionalOffer({ keyId: cfg.key_id, privateKeyPem: data.credential }, {
      bundleId: cfg.bundle_id, productId, offerId, appAccountToken, nonce: crypto.randomUUID(), timestamp: Date.now(),
    })
  } catch (e) {
    console.warn(`winback: App Store offer signing failed for tenant ${tenantId}: ${(e as Error).message}`)
    return null
  }
}
