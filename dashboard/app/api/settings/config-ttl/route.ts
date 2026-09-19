export const runtime = "edge"

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

/**
 * The SDK's config cache TTL, as a setting.
 *
 * GET   → { seconds }
 * PATCH { seconds } → { seconds }  — the value ACTUALLY stored, after clamping
 *
 * This is not a caching knob. The SDK is fully server-driven, so this number is how long a change
 * made in this dashboard stays invisible on a device: shorten it and a corrected price reaches
 * buyers in minutes, lengthen it and devices ask less often.
 *
 * The RPC clamps to 30..86400 rather than rejecting, and this route returns what was stored so the
 * UI shows the truth instead of the request. 0 is impossible by CHECK — the SDK reads
 * `cacheTtlSeconds = 0` as its STALE sentinel, so storing 0 would make every cached read look
 * permanently expired rather than "never cache".
 */
export async function GET() {
  const { tenant } = await requireTenant()
  const supabase = createClient()
  const { data, error } = await supabase.rpc("tenant_config_ttl_get", { p_tenant_id: tenant.id })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ seconds: data })
}

export async function PATCH(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const body = await req.json().catch(() => ({}))
  const seconds = Number(body?.seconds)

  // Reject only what is not a number at all. Out-of-range values are the RPC's job to clamp, so the
  // operator gets the nearest legal value rather than a refusal with no result.
  if (!Number.isFinite(seconds)) {
    return NextResponse.json({ error: "seconds must be a number" }, { status: 400 })
  }

  const supabase = createClient()
  const { data, error } = await supabase.rpc("tenant_config_ttl_set", {
    p_tenant_id: tenant.id,
    p_seconds: Math.round(seconds),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase
    .rpc("audit_log_emit", {
      p_tenant_id: tenant.id,
      p_actor_user_id: userId,
      p_actor_type: "user",
      p_action: "settings.config_ttl_updated",
      p_resource: `tenants:id=${tenant.id}`,
      p_after: { config_cache_ttl_seconds: data },
    })
    .then(
      () => {},
      () => {},
    )

  return NextResponse.json({ seconds: data })
}
