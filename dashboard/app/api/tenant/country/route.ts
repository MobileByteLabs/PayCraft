import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

/**
 * Update the merchant's primary country.
 *
 * POST body: { country_code: "IN" | "US" | "CA" | … }  (or null to clear)
 *
 * Persisted to `tenants.country_code` (migration 061). Drives the
 * /providers page recommendation tier, and acts as the fallback customer
 * country when the SDK doesn't pass one explicitly.
 */
export async function POST(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const supabase = createClient()
  const body = await req.json()
  const code: string | null = body?.country_code ?? null

  if (code !== null && (typeof code !== "string" || !/^[A-Za-z]{2}$/.test(code))) {
    return NextResponse.json(
      { error: "country_code must be a 2-letter ISO 3166-1 alpha-2 code" },
      { status: 400 },
    )
  }

  const { error } = await supabase.rpc("tenants_set_country_code", {
    p_tenant_id: tenant.id,
    p_country_code: code,
  })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "tenant.country_set",
    p_resource: `tenants:id=${tenant.id}`,
    p_after: { country_code: code },
  })

  return NextResponse.json({ ok: true, country_code: code?.toUpperCase() ?? null })
}
