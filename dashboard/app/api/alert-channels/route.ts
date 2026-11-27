import { NextRequest, NextResponse } from "next/server"
import { createClient as createServiceClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import {
  ALERT_KINDS,
  CHANNEL_KINDS,
  parseChannelsUpdate,
  redactUrls,
  rpcErrorCode,
  toPublicChannels,
  type ChannelKind,
  type ChannelStatus,
} from "@/lib/alert-channels"

/**
 * Owner alert channels (migration 211) — Settings ▸ Alert channels.
 *
 * GET                                              → PublicChannels (no URL, no secret — booleans + "set"/"unset")
 * PUT  { email_enabled?, slack_url?, webhook_url?, webhook_secret?, kinds? }
 *      absent = keep, "" = clear (slack / webhook)   → PublicChannels
 * POST { action: "test", channel }                 → { ok, delivery } — sends a channel_test alert now
 *
 * Channels are written only through `tenant_alert_channels_save` as the signed-in admin (the RPC checks membership
 * and encrypts); the secret goes in and never comes out. Kind toggles (`tenant_alert_prefs`) and the test send are
 * service-role only in the database, so they run with the service key AFTER requireTenant() has proved the caller
 * administers the active app.
 */

const service = () =>
  createServiceClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

const fail = (error: string, status = 400) => NextResponse.json({ error }, { status })

async function loadStatus(sb: ReturnType<typeof createClient>, tenantId: string): Promise<ChannelStatus> {
  const { data, error } = await sb.rpc("tenant_alert_channels_status", { p_tenant_id: tenantId })
  if (error) throw Object.assign(new Error(error.message), { code: error.code })
  const row = (Array.isArray(data) ? data[0] : data) as ChannelStatus | undefined
  return row ?? { email_enabled: true, slack_configured: false, webhook_configured: false, inbox_enabled: true, updated_at: null }
}

async function loadPrefs(tenantId: string) {
  const { data, error } = await service()
    .from("tenant_alert_prefs")
    .select(ALERT_KINDS.map((k) => k.key).join(","))
    .eq("tenant_id", tenantId)
    .maybeSingle()
  if (error) throw new Error(`tenant_alert_prefs: ${error.message}`)
  return (data ?? null) as Record<string, unknown> | null
}

function errorResponse(e: unknown) {
  const err = e as { message?: string; code?: string }
  if (err.code === "42501" || err.message?.includes("forbidden")) return fail("forbidden", 403)
  const code = rpcErrorCode(err.message ?? "")
  return code ? fail(code) : fail(err.message ?? "server_error", 500)
}

export async function GET() {
  const { tenant } = await requireTenant()
  try {
    const sb = createClient()
    const [status, prefs] = await Promise.all([loadStatus(sb, tenant.id), loadPrefs(tenant.id)])
    return NextResponse.json(toPublicChannels(status, prefs, tenant.owner_email ?? null))
  } catch (e) {
    return errorResponse(e)
  }
}

export async function PUT(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  if (!body || typeof body !== "object") return fail("bad_body")
  try {
    const sb = createClient()
    const current = await loadStatus(sb, tenant.id)
    const parsed = parseChannelsUpdate(body, current)
    if (!parsed.ok) return fail(parsed.error)

    // The RPC encrypts the Slack URL and the webhook URL + secret; a blank secret keeps the stored one.
    const { error } = await sb.rpc("tenant_alert_channels_save", { p_tenant_id: tenant.id, ...parsed.rpc })
    if (error) throw Object.assign(new Error(error.message), { code: error.code })

    if (parsed.kinds && Object.keys(parsed.kinds).length) {
      const { error: prefsError } = await service()
        .from("tenant_alert_prefs")
        .upsert({ tenant_id: tenant.id, ...parsed.kinds, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" })
      if (prefsError) throw new Error(`tenant_alert_prefs: ${prefsError.message}`)
    }

    // Audit what changed — never a URL or the secret.
    const change = (v: string | null) => (v === null ? "kept" : v === "" ? "cleared" : "set")
    await sb
      .rpc("audit_log_emit", {
        p_tenant_id: tenant.id,
        p_actor_user_id: userId,
        p_actor_type: "user",
        p_action: "alert_channels.save",
        p_resource: "tenant_alert_channels",
        p_after: {
          email_enabled: parsed.rpc.p_email_enabled,
          slack: change(parsed.rpc.p_slack_url),
          webhook: change(parsed.rpc.p_webhook_url),
          webhook_secret_rotated: parsed.rpc.p_webhook_secret !== null,
          kinds: parsed.kinds,
        },
      })
      .then(() => {}, () => {})

    const [status, prefs] = await Promise.all([loadStatus(sb, tenant.id), loadPrefs(tenant.id)])
    return NextResponse.json(toPublicChannels(status, prefs, tenant.owner_email ?? null))
  } catch (e) {
    return errorResponse(e)
  }
}

type TestDelivery = { channel: ChannelKind; ok: boolean; httpStatus: number | null; error: string | null; attempts: number | null }

export async function POST(req: NextRequest) {
  const { tenant } = await requireTenant()
  const body = (await req.json().catch(() => null)) as { action?: string; channel?: string } | null
  if (body?.action !== "test") return fail("bad_body")
  const channel = body.channel as ChannelKind
  if (!CHANNEL_KINDS.includes(channel)) return fail("bad_channel")
  try {
    const status = await loadStatus(createClient(), tenant.id)
    const ready: Record<ChannelKind, boolean> = {
      email: status.email_enabled && !!tenant.owner_email,
      slack: status.slack_configured,
      webhook: status.webhook_configured,
      inbox: status.inbox_enabled,
    }
    if (!ready[channel]) return fail("channel_not_configured")

    // The alert engine's test mode (service role only): records a channel_test alert and delivers it to this
    // channel through the same sender real alerts use, so a green test means real alerts will arrive.
    const base = process.env.NEXT_PUBLIC_SUPABASE_URL!.replace(/\/+$/, "")
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
    const url = `${base}/functions/v1/attempt-alerts?${new URLSearchParams({ mode: "test", tenant_id: tenant.id, channel })}`
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, apikey: key },
      signal: AbortSignal.timeout(30_000),
    })
    const out = (await res.json().catch(() => null)) as { ok?: boolean; alert_id?: string; deliveries?: TestDelivery[]; error?: string } | null
    if (!res.ok || !out?.ok) return NextResponse.json({ error: "test_failed", detail: redactUrls(out?.error ?? `HTTP ${res.status}`) }, { status: 502 })
    const delivery = out.deliveries?.find((d) => d.channel === channel) ?? null
    if (!delivery) return NextResponse.json({ error: "channel_not_configured" }, { status: 400 })
    return NextResponse.json({
      ok: delivery.ok,
      alert_id: out.alert_id,
      delivery: { channel, ok: delivery.ok, http_status: delivery.httpStatus, error: redactUrls(delivery.error), attempts: delivery.attempts },
    })
  } catch (e) {
    return errorResponse(e)
  }
}
