import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

interface SaveBody {
  test_secret_key: string
  test_publishable_key: string
  test_webhook_secret: string
  live_secret_key: string
  live_publishable_key: string
  live_webhook_secret: string
}

/**
 * Manual Stripe API key flow — for local dev and single-tenant deployments
 * where setting up a full Stripe Connect platform isn't worth it. Mirrors the
 * Razorpay manual-keys flow at /api/providers/razorpay so users can choose
 * whichever onboarding path fits their stage.
 *
 * Test mode is required. Live mode is optional — if the dashboard's "Also
 * configure live keys" toggle is OFF, the frontend echoes the test values into
 * the live slots; we detect that and skip live-mode validation so the operator
 * can ship to dev without provisioning a Stripe live account first. The DB row
 * just ends up holding the test values in both slots, and the SDK auto-routes
 * to test mode at runtime via the pk_test_/pk_live_ prefix check.
 *
 * Each key is validated against Stripe's live API (`balance.retrieve()` is a
 * cheap one-shot that proves the secret authenticates) before persistence.
 * Keys are then stored encrypted via the provider-agnostic
 * `tenant_providers_save_keys` RPC.
 */
async function validateStripeSecret(
  secret: string,
  mode: "test" | "live",
): Promise<string | null> {
  const prefix = mode === "test" ? "sk_test_" : "sk_live_"
  if (!secret.startsWith(prefix)) {
    return `${mode}_secret_key must start with ${prefix}`
  }
  try {
    const client = new Stripe(secret, { apiVersion: "2026-05-27.dahlia" })
    await client.balance.retrieve()
    return null
  } catch (e: any) {
    return `${mode} key invalid: ${e.message ?? "auth failed"}`
  }
}

function validatePublishable(key: string, mode: "test" | "live"): string | null {
  const prefix = mode === "test" ? "pk_test_" : "pk_live_"
  if (!key.startsWith(prefix)) {
    return `${mode}_publishable_key must start with ${prefix}`
  }
  return null
}

export async function POST(req: NextRequest) {
  const { tenant } = await requireTenant()
  const body = (await req.json()) as Partial<SaveBody>
  const supabase = createClient()

  // First save vs. partial-update branch. If a row already exists in
  // tenant_providers, treat empty/missing fields as "don't change" so the
  // dashboard's "Update keys" CTA can swap a single value (e.g. just the
  // webhook secret from `stripe listen`) without re-pasting everything.
  const { data: existing } = await supabase
    .from("tenant_providers")
    .select("test_key_id")
    .eq("tenant_id", tenant.id)
    .eq("provider", "stripe")
    .maybeSingle()
  const isUpdate = !!existing

  const t = (s: string | undefined) => (s && s.trim() ? s.trim() : "")
  const test_pk = t(body.test_publishable_key)
  const test_sk = t(body.test_secret_key)
  const test_wh = t(body.test_webhook_secret)
  const live_pk = t(body.live_publishable_key)
  const live_sk = t(body.live_secret_key)
  const live_wh = t(body.live_webhook_secret)

  // Detect "live keys actually configured" — the dashboard echoes test values
  // into the live slots when the live toggle is off. Anything truly new in the
  // live slots gets validated; otherwise live slots stay untouched (or mirror
  // test on first save).
  const liveProvided = !!live_pk && (live_pk !== test_pk || live_sk !== test_sk)

  const errors: string[] = []

  if (test_sk) {
    const e = await validateStripeSecret(test_sk, "test")
    if (e) errors.push(e)
  } else if (!isUpdate) {
    errors.push("test_secret_key is required for first-time save")
  }
  if (test_pk) {
    const e = validatePublishable(test_pk, "test")
    if (e) errors.push(e)
  } else if (!isUpdate) {
    errors.push("test_publishable_key is required for first-time save")
  }
  if (liveProvided) {
    const e1 = await validateStripeSecret(live_sk, "live")
    if (e1) errors.push(e1)
    const e2 = validatePublishable(live_pk, "live")
    if (e2) errors.push(e2)
  }

  // For a fresh save the operator must also paste at least one webhook secret
  // (test). For partial updates we don't enforce — they may just be swapping
  // pk_/sk_ and keeping the existing webhook.
  if (!isUpdate && !test_wh) {
    errors.push("test_webhook_secret is required for first-time save")
  }

  if (errors.length) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 400 })
  }

  if (isUpdate) {
    const { error } = await supabase.rpc("tenant_providers_update_keys", {
      p_tenant_id: tenant.id,
      p_provider: "stripe",
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

  // Initial save — RPC requires all six fields. Echo test → live when the
  // operator hasn't filled in a separate live set yet.
  const { error } = await supabase.rpc("tenant_providers_save_keys", {
    p_tenant_id: tenant.id,
    p_provider: "stripe",
    p_test_key_id: test_pk,
    p_test_secret: test_sk,
    p_test_webhook_secret: test_wh,
    p_live_key_id: liveProvided ? live_pk : test_pk,
    p_live_secret: liveProvided ? live_sk : test_sk,
    p_live_webhook_secret: liveProvided ? live_wh : test_wh,
    p_supported_locales: null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, mode: "create" })
}
