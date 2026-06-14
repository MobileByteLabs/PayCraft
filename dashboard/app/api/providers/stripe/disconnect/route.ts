import { NextResponse } from "next/server"
import Stripe from "stripe"
import { requireTenant } from "@/lib/tenant"
import { createClient } from "@/lib/supabase-server"
import { getPlatformStripeClient } from "@/lib/stripe-client"

export async function POST() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const { data, error } = await supabase
    .rpc("tenant_stripe_connect_for_disconnect", { p_tenant_id: tenant.id })
    .single<{ access_token: string; stripe_account_id: string; webhook_endpoint_id: string | null }>()

  if (error || !data) {
    return NextResponse.json({ ok: true, note: "no connection found" })
  }

  // 1. Revoke webhook endpoint on the connected account.
  if (data.webhook_endpoint_id) {
    try {
      const connected = new Stripe(data.access_token, { apiVersion: "2024-11-20.acacia" })
      await connected.webhookEndpoints.del(data.webhook_endpoint_id)
    } catch (e: any) {
      console.error("[stripe-disconnect] webhook delete failed:", e.message)
    }
  }

  // 2. Deauthorize via platform.
  if (process.env.STRIPE_CONNECT_CLIENT_ID) {
    try {
      const platform = getPlatformStripeClient()
      await platform.oauth.deauthorize({
        client_id: process.env.STRIPE_CONNECT_CLIENT_ID,
        stripe_user_id: data.stripe_account_id,
      })
    } catch (e: any) {
      console.error("[stripe-disconnect] deauthorize failed:", e.message)
    }
  }

  // 3. Clear row.
  await supabase.rpc("tenant_stripe_connect_soft_delete", { p_tenant_id: tenant.id })

  return NextResponse.json({ ok: true })
}
