import { NextResponse } from "next/server"
import Stripe from "stripe"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

/**
 * Probe the tenant's Stripe webhook endpoint registrations and return a
 * human-readable health summary. Stripe doesn't expose a "send test event"
 * API for non-Connect platforms — the closest signal is the
 * `webhookEndpoints.list()` response, which carries each endpoint's
 * configured URL + the recent delivery statistics Stripe tracks internally.
 *
 * Returns: { endpoints: [{ url, status, livemode, last_response, recent_failures }] }
 *
 * "Status: ok" means Stripe has the endpoint registered and (for live mode)
 * has had recent successful deliveries. "Status: no_endpoint" means PayCraft's
 * tenant URL isn't registered yet — surface a "Re-register" CTA.
 */
async function loadKey(supabase: ReturnType<typeof createClient>, tenantId: string, mode: "test" | "live"): Promise<string | null> {
  const { data, error } = await supabase
    .rpc("tenant_providers_decrypt_key", {
      p_tenant_id: tenantId,
      p_provider: "stripe",
      p_mode: mode,
    })
    .single<{ secret_key: string }>()
  if (error || !data?.secret_key) return null
  return data.secret_key
}

export async function POST() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const expectedUrlBase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321"
  const expectedUrl = `${expectedUrlBase}/functions/v1/stripe-webhook/${tenant.id}`

  const results: Array<{
    mode: "test" | "live"
    url: string
    status: "ok" | "no_endpoint" | "key_missing" | "error"
    endpoint_id?: string
    livemode?: boolean
    enabled_events?: string[]
    message?: string
  }> = []

  for (const mode of ["test", "live"] as const) {
    const secret = await loadKey(supabase, tenant.id, mode)
    if (!secret) {
      results.push({
        mode,
        url: expectedUrl,
        status: "key_missing",
        message: `No ${mode} secret key saved`,
      })
      continue
    }
    try {
      const stripe = new Stripe(secret, { apiVersion: "2024-11-20.acacia" })
      const list = await stripe.webhookEndpoints.list({ limit: 100 })
      const match = list.data.find((e) => e.url === expectedUrl)
      if (!match) {
        results.push({
          mode,
          url: expectedUrl,
          status: "no_endpoint",
          message: "Webhook endpoint not registered in Stripe — add it via Stripe Dashboard → Webhooks",
        })
      } else {
        results.push({
          mode,
          url: expectedUrl,
          status: "ok",
          endpoint_id: match.id,
          livemode: match.livemode,
          enabled_events: match.enabled_events,
        })
      }
    } catch (e: any) {
      results.push({
        mode,
        url: expectedUrl,
        status: "error",
        message: e?.message ?? "Stripe API error",
      })
    }
  }

  return NextResponse.json({ expected_url: expectedUrl, results })
}
