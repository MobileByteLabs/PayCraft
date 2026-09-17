export const runtime = "edge"

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

/**
 * Point THIS app at a connection — or at nothing, which means "follow the account default".
 *
 * Null is a real choice, not an absence: an app that follows the default picks up a credential
 * rotation automatically, which is the behaviour most operators want and the reason the default
 * exists at all.
 */
export async function POST(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const body = (await req.json()) as {
    provider?: string
    accountId?: string | null
    appConfig?: Record<string, unknown> | null
  }
  if (!body.provider) {
    return NextResponse.json({ error: "provider is required" }, { status: 400 })
  }

  const supabase = createClient()
  const { error } = await supabase.rpc("tenant_provider_attach", {
    p_tenant: tenant.id,
    p_provider: body.provider,
    p_account_id: body.accountId ?? null,
    p_app_config: body.appConfig ?? null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  const { data: resolved } = await supabase.rpc("tenant_provider_resolve", {
    p_tenant: tenant.id,
    p_provider: body.provider,
  })

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "provider.connection_changed",
    p_resource: `tenant_providers:${tenant.id}:${body.provider}`,
    p_after: resolved as object,
  })
  return NextResponse.json({ ok: true, resolved })
}
