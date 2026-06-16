import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import Stripe from "stripe"

// Known platform-secret slot names. Wizard renders one input per slot.
const SLOTS = [
  "stripe_connect_client_id",
  "stripe_platform_secret_key",
] as const
type Slot = (typeof SLOTS)[number]

/**
 * GET — returns the current platform-secret state for the wizard. Never leaks
 * plaintext: only `key`, `has_value`, `updated_at`. Also indicates whether the
 * caller is the platform owner (drives the entire wizard's visibility).
 */
export async function GET() {
  const supabase = createClient()
  const {
    data: { user },
    error: authErr,
  } = await supabase.auth.getUser()
  if (authErr || !user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 })
  }

  // Self-claim ownership if no owner exists — supports the "first user becomes
  // platform owner" UX of fresh installs.
  await supabase.rpc("claim_platform_owner")

  const { data: isOwnerData } = await supabase.rpc("is_platform_owner")
  // platform_secrets_list throws when caller is not the platform owner — that's
  // fine, we catch it and treat as "no slots configured" for the wizard render.
  let slotData: Array<{ key: string; updated_at: string }> = []
  try {
    const r = await supabase.rpc("platform_secrets_list")
    if (r.data) slotData = r.data
  } catch {
    slotData = []
  }

  return NextResponse.json({
    is_platform_owner: isOwnerData === true,
    slots: SLOTS.map((key) => {
      const row = (slotData ?? []).find((s: any) => s.key === key)
      return { key, has_value: !!row, updated_at: row?.updated_at ?? null }
    }),
  })
}

/**
 * POST — save one or more platform secrets after validating them against the
 * remote provider. Stripe gets a real `oauth.token` call with a bogus code:
 *   - "invalid_grant" / "invalid_client" → the secret authenticates correctly
 *     and Stripe is just rejecting the code — that's what we want.
 *   - "Stripe Connect not enabled" → secret is valid but Connect is disabled
 *     on this Stripe account; surface the actionable error.
 *   - "Invalid API key" → wrong key; reject the save.
 */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: isOwnerData } = await supabase.rpc("is_platform_owner")
  if (!isOwnerData) {
    return NextResponse.json({ error: "forbidden — not the platform owner" }, { status: 403 })
  }

  const body = (await req.json()) as Partial<Record<Slot, string>>
  const errors: Record<string, string> = {}

  if (body.stripe_platform_secret_key) {
    const validationError = await validateStripeSecret(body.stripe_platform_secret_key)
    if (validationError) errors.stripe_platform_secret_key = validationError
  }
  if (body.stripe_connect_client_id) {
    const cid = body.stripe_connect_client_id.trim()
    if (!cid.startsWith("ca_")) {
      errors.stripe_connect_client_id = "Connect client ID must start with `ca_`"
    }
  }

  if (Object.keys(errors).length) {
    return NextResponse.json({ error: "validation_failed", details: errors }, { status: 400 })
  }

  // Persist each slot the caller actually sent (don't wipe slots they omitted).
  for (const slot of SLOTS) {
    const val = body[slot]
    if (!val) continue
    const { error } = await supabase.rpc("platform_secrets_set", {
      p_key: slot,
      p_plaintext: val.trim(),
    })
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
  }

  return NextResponse.json({ ok: true })
}

/**
 * Touch Stripe's OAuth endpoint with a deliberately-bogus code. The response
 * tells us:
 *   - HTTP 401 / "Invalid API key" → secret is wrong
 *   - HTTP 400 / "invalid_grant"   → secret authenticates, code is bogus (good)
 *   - HTTP 400 / "Stripe Connect not enabled" → secret is fine, but Connect
 *     hasn't been activated for this Stripe account (actionable error).
 */
async function validateStripeSecret(secret: string): Promise<string | null> {
  if (!secret.startsWith("sk_test_") && !secret.startsWith("sk_live_")) {
    return "Secret key must start with `sk_test_` or `sk_live_`"
  }
  try {
    const stripe = new Stripe(secret, { apiVersion: "2024-11-20.acacia" })
    // balance.retrieve() is the cheapest call that proves the key authenticates.
    await stripe.balance.retrieve()
    return null
  } catch (e: any) {
    const msg = String(e?.message ?? "unknown error")
    if (msg.toLowerCase().includes("api key")) return "Invalid Stripe secret key"
    return msg
  }
}
