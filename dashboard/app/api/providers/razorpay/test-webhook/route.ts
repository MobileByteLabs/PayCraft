import { NextResponse } from "next/server"
import Razorpay from "razorpay"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

/**
 * Probe the tenant's Razorpay account for registered webhooks and check
 * whether our expected URL is registered for each mode.
 *
 * Razorpay's webhook list lives at GET /v1/webhooks (returns array of
 * { id, url, alert_email, secret, events[] }). The shared SDK doesn't
 * expose this method on its typed surface, so we use the raw HTTP API
 * via fetch with basic-auth.
 *
 * Returns per-mode {status: ok | no_endpoint | key_missing | error}.
 * The dashboard uses this to drive the same kind of REGISTERED ✓ chip
 * the Stripe test-webhook view shows.
 */
const RAZORPAY_API = "https://api.razorpay.com/v1/webhooks"

interface WebhookRow {
  id: string
  url: string
  alert_email?: string
  events: string[]
  active?: boolean
}

async function loadKeys(
  supabase: ReturnType<typeof createClient>,
  tenantId: string,
  mode: "test" | "live",
): Promise<{ keyId: string; secret: string } | null> {
  const { data, error } = await supabase
    .rpc("tenant_providers_decrypt_key", {
      p_tenant_id: tenantId,
      p_provider: "razorpay",
      p_mode: mode,
    })
    .single<{ secret_key: string; key_id: string }>()
  if (error || !data?.secret_key || !data?.key_id) return null
  return { keyId: data.key_id, secret: data.secret_key }
}

async function listWebhooks(
  keyId: string,
  secret: string,
): Promise<WebhookRow[]> {
  const auth = Buffer.from(`${keyId}:${secret}`).toString("base64")
  const res = await fetch(`${RAZORPAY_API}?count=100`, {
    headers: { Authorization: `Basic ${auth}` },
  })
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(
      `Razorpay webhooks list failed (${res.status}): ${body?.error?.description ?? res.statusText}`,
    )
  }
  const data = await res.json()
  return (data?.items ?? []) as WebhookRow[]
}

export async function POST() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const expectedUrlBase =
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? "http://localhost:54321"
  const expectedUrl = `${expectedUrlBase}/functions/v1/razorpay-webhook/${tenant.id}`

  const results: Array<{
    mode: "test" | "live"
    url: string
    status: "ok" | "no_endpoint" | "key_missing" | "error"
    endpoint_id?: string
    enabled_events?: string[]
    message?: string
  }> = []

  for (const mode of ["test", "live"] as const) {
    const creds = await loadKeys(supabase, tenant.id, mode)
    if (!creds) {
      results.push({
        mode,
        url: expectedUrl,
        status: "key_missing",
        message: `No ${mode} keys saved`,
      })
      continue
    }
    try {
      const hooks = await listWebhooks(creds.keyId, creds.secret)
      const match = hooks.find((h) => h.url === expectedUrl && h.active !== false)
      if (!match) {
        results.push({
          mode,
          url: expectedUrl,
          status: "no_endpoint",
          message:
            "Webhook URL not registered in Razorpay Dashboard for this account",
        })
      } else {
        results.push({
          mode,
          url: expectedUrl,
          status: "ok",
          endpoint_id: match.id,
          enabled_events: match.events,
        })
      }
    } catch (e: any) {
      results.push({
        mode,
        url: expectedUrl,
        status: "error",
        message: e?.message ?? "Razorpay API error",
      })
    }
  }

  return NextResponse.json({ expected_url: expectedUrl, results })
}
