import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

/**
 * Real connection status for the Stripe provider — checks both the OAuth
 * Connect row AND the manual-keys row, returning whichever is populated.
 * Replaces the mocked `connected: true` placeholder the page used to ship.
 */
export async function GET() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  // 1. OAuth Connect row (stripe_account_id populated by the OAuth callback).
  const { data: connect } = await supabase
    .rpc("tenant_stripe_connect_status", { p_tenant_id: tenant.id })
    .single<{ stripe_account_id: string; livemode: boolean }>()
  if (connect?.stripe_account_id) {
    return NextResponse.json({
      connected: true,
      mode: "oauth",
      account_id: connect.stripe_account_id,
      livemode: connect.livemode,
    })
  }

  // 2. Manual-keys row (saved via /api/providers/stripe/keys).
  const { data: providerRow } = await supabase
    .rpc("tenant_providers_status", { p_tenant_id: tenant.id, p_provider: "stripe" })
    .single<{ test_key_id: string | null; live_key_id: string | null; connected: boolean }>()
  if (providerRow?.connected) {
    // Mask the publishable key — only the prefix (mode + first 8 chars) leaves
    // the server. Publishable keys aren't authorization material, but we still
    // don't dump the full string into API responses or logs.
    const fullKey = providerRow.live_key_id ?? providerRow.test_key_id ?? ""
    const masked = fullKey.length > 16 ? `${fullKey.slice(0, 11)}…${fullKey.slice(-4)}` : fullKey
    return NextResponse.json({
      connected: true,
      mode: "keys",
      account_id: masked,
      livemode: !!providerRow.live_key_id,
    })
  }

  return NextResponse.json({
    connected: false,
    mode: null,
    account_id: null,
    livemode: false,
  })
}
