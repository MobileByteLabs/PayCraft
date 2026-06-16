import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

/**
 * Cashfree credentials persistence — same shape as the Stripe / Razorpay
 * Manual API keys flow. Saves via `tenant_providers_save_keys` /
 * `tenant_providers_update_keys` so the credentials live in the same
 * encrypted-at-rest table as the other providers.
 *
 * Validation here is lighter than Stripe's: Cashfree doesn't publish a
 * trivial "balance/ping" endpoint we can call as a cheap auth probe, so we
 * just sanity-check non-empty + format. Bad keys will surface at first
 * payment-link create instead.
 */
interface Body {
  test_app_id: string
  test_secret_key: string
  test_webhook_secret: string
  live_app_id: string
  live_secret_key: string
  live_webhook_secret: string
}

export async function POST(req: NextRequest) {
  const { tenant } = await requireTenant()
  const body = (await req.json()) as Partial<Body>
  const supabase = createClient()

  const t = (s: string | undefined) => (s && s.trim() ? s.trim() : "")
  const test_pk = t(body.test_app_id)
  const test_sk = t(body.test_secret_key)
  const test_wh = t(body.test_webhook_secret)
  const live_pk = t(body.live_app_id)
  const live_sk = t(body.live_secret_key)
  const live_wh = t(body.live_webhook_secret)

  // Detect first save vs partial update — same pattern as the Stripe keys
  // route. When existing row is present, NULL params on the update RPC
  // mean "keep existing".
  const { data: existing } = await supabase
    .from("tenant_providers")
    .select("test_key_id")
    .eq("tenant_id", tenant.id)
    .eq("provider", "cashfree")
    .maybeSingle()
  const isUpdate = !!existing

  if (!isUpdate) {
    if (!test_pk || !test_sk) {
      return NextResponse.json(
        { error: "test_app_id + test_secret_key required for first-time save" },
        { status: 400 },
      )
    }
  }
  // Live keys only count as "provided" when distinct from test (the form
  // echoes blank when "Also configure live keys" is off).
  const liveProvided = !!live_pk && live_pk !== test_pk

  if (isUpdate) {
    const { error } = await supabase.rpc("tenant_providers_update_keys", {
      p_tenant_id: tenant.id,
      p_provider: "cashfree",
      p_test_key_id: test_pk || null,
      p_test_secret: test_sk || null,
      p_test_webhook_secret: test_wh || null,
      p_live_key_id: liveProvided ? live_pk : null,
      p_live_secret: liveProvided ? live_sk : null,
      p_live_webhook_secret: liveProvided ? live_wh : null,
      p_supported_locales: null,
    })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, mode: "update" })
  }

  const { error } = await supabase.rpc("tenant_providers_save_keys", {
    p_tenant_id: tenant.id,
    p_provider: "cashfree",
    p_test_key_id: test_pk,
    p_test_secret: test_sk,
    p_test_webhook_secret: test_wh || "pending-webhook",
    p_live_key_id: liveProvided ? live_pk : test_pk,
    p_live_secret: liveProvided ? live_sk : test_sk,
    p_live_webhook_secret: liveProvided ? live_wh : test_wh || "pending-webhook",
    p_supported_locales: null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, mode: "create" })
}
