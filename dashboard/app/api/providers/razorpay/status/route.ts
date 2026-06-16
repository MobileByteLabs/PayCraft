import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

/**
 * Razorpay connection status — does this tenant have credentials saved?
 * Mirrors /api/providers/stripe/status. Returns masked key IDs (never
 * secrets) for display.
 */
export async function GET() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const { data } = await supabase
    .from("tenant_providers")
    .select("test_key_id, live_key_id, created_at, updated_at")
    .eq("tenant_id", tenant.id)
    .eq("provider", "razorpay")
    .maybeSingle()

  if (!data) {
    return NextResponse.json({ connected: false })
  }

  const mask = (key: string | null): string | null => {
    if (!key) return null
    if (key.length <= 16) return key
    return `${key.slice(0, 11)}…${key.slice(-4)}`
  }

  return NextResponse.json({
    connected: true,
    mode: "keys",
    test_key_id: mask(data.test_key_id),
    live_key_id: mask(data.live_key_id),
    livemode: !!data.live_key_id && data.live_key_id !== data.test_key_id,
    connected_at: data.created_at,
    updated_at: data.updated_at,
  })
}
