import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

/**
 * Attribution forwarding credentials (migration 208) — where PayCraft's server sends this app's verified
 * purchases, renewals and refunds.
 *
 * GET                                   → { ga4: { firebase_app_id } | null, appsflyer: { app_id } | null }
 * PUT    { platform: "ga4", firebase_app_id, api_secret? }
 *        { platform: "appsflyer", app_id, dev_key? }            → { ok }
 * DELETE ?platform=ga4|appsflyer                                → { ok }
 *
 * The secret (GA4 api_secret / AppsFlyer dev key) is write-only: encrypted by `tenant_attribution_save`,
 * never returned. Blank on an update keeps the stored one.
 */
const PLATFORMS = ["ga4", "appsflyer"] as const
type Platform = (typeof PLATFORMS)[number]
const FIREBASE_APP_ID = /^1:[0-9]+:(android|ios|web):[0-9a-f]+$/
const APPSFLYER_APP_ID = /^(id[0-9]{5,12}|[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+)$/

function rpcError(error: { code?: string; message: string }) {
  if (error.code === "42501") return NextResponse.json({ error: "forbidden" }, { status: 403 })
  if (error.message.includes("secret_required")) return NextResponse.json({ error: "secret_required" }, { status: 400 })
  return NextResponse.json({ error: error.message }, { status: 500 })
}

export async function GET() {
  const { tenant } = await requireTenant()
  const supabase = createClient()
  const { data, error } = await supabase.rpc("tenant_attribution_status", { p_tenant_id: tenant.id })
  if (error) return rpcError(error)
  const rows = (data ?? []) as Array<{ platform: Platform; config: Record<string, string> }>
  const find = (p: Platform) => rows.find((r) => r.platform === p)?.config ?? null
  return NextResponse.json({ ga4: find("ga4"), appsflyer: find("appsflyer") })
}

export async function PUT(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null
  const platform = body?.platform as Platform
  if (!PLATFORMS.includes(platform)) return NextResponse.json({ error: "bad_platform" }, { status: 400 })

  let config: Record<string, string>
  let secret: string
  if (platform === "ga4") {
    const appId = String(body?.firebase_app_id ?? "").trim()
    if (!FIREBASE_APP_ID.test(appId)) return NextResponse.json({ error: "bad_firebase_app_id" }, { status: 400 })
    config = { firebase_app_id: appId }
    secret = String(body?.api_secret ?? "").trim()
  } else {
    const appId = String(body?.app_id ?? "").trim()
    if (!APPSFLYER_APP_ID.test(appId)) return NextResponse.json({ error: "bad_app_id" }, { status: 400 })
    config = { app_id: appId }
    secret = String(body?.dev_key ?? "").trim()
  }
  if (secret.length > 200) return NextResponse.json({ error: "bad_secret" }, { status: 400 })

  const supabase = createClient()
  const { error } = await supabase.rpc("tenant_attribution_save", {
    p_tenant_id: tenant.id,
    p_platform: platform,
    p_config: config,
    p_secret: secret,
  })
  if (error) return rpcError(error)
  await supabase
    .rpc("audit_log_emit", {
      p_tenant_id: tenant.id,
      p_actor_user_id: userId,
      p_actor_type: "user",
      p_action: "attribution.save",
      p_resource: `tenant_attribution_integrations:platform=${platform}`,
      p_after: { ...config, secret_rotated: secret.length > 0 },
    })
    .then(() => {}, () => {})
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const platform = req.nextUrl.searchParams.get("platform") as Platform
  if (!PLATFORMS.includes(platform)) return NextResponse.json({ error: "bad_platform" }, { status: 400 })
  const supabase = createClient()
  const { error } = await supabase.rpc("tenant_attribution_delete", { p_tenant_id: tenant.id, p_platform: platform })
  if (error) return rpcError(error)
  await supabase
    .rpc("audit_log_emit", {
      p_tenant_id: tenant.id,
      p_actor_user_id: userId,
      p_actor_type: "user",
      p_action: "attribution.delete",
      p_resource: `tenant_attribution_integrations:platform=${platform}`,
      p_after: null,
    })
    .then(() => {}, () => {})
  return NextResponse.json({ ok: true })
}
