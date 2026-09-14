export const runtime = "edge"

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

/**
 * Account-level provider connections.
 *
 * Credentials belong to the ACCOUNT, not to one app: an operator running six apps off one Play
 * console connects it once, and rotating it is one edit rather than six. Each app then points at a
 * connection, or follows the account default.
 *
 * The credential itself never comes back out — `provider_accounts_list` returns `has_credential`
 * only. Nothing here can be used to read a key.
 */
export async function GET(req: NextRequest) {
  await requireTenant()
  const provider = new URL(req.url).searchParams.get("provider")
  const supabase = createClient()
  const { data, error } = await supabase.rpc("provider_accounts_list", {
    p_provider: provider,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })
  return NextResponse.json({ connections: data ?? [] })
}

export async function POST(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const body = (await req.json()) as {
    id?: string | null
    provider?: string
    label?: string
    credential?: string
    config?: Record<string, unknown>
  }
  if (!body.provider || !body.label) {
    return NextResponse.json({ error: "provider and label are required" }, { status: 400 })
  }

  const supabase = createClient()
  const { data, error } = await supabase.rpc("provider_accounts_save", {
    p_id: body.id ?? null,
    p_provider: body.provider,
    p_label: body.label,
    // Blank means "keep the existing key" — so renaming a connection never requires re-pasting a
    // secret the operator may not have to hand.
    p_credential: body.credential ?? null,
    p_config: body.config ?? {},
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: body.id ? "provider_account.updated" : "provider_account.created",
    p_resource: `provider_accounts:${data}`,
    // The label and provider are safe to record; the credential is never in this payload.
    p_after: { id: data, provider: body.provider, label: body.label },
  })
  return NextResponse.json({ ok: true, id: data })
}

/** Make a connection the account default — every app that follows the default moves with it. */
export async function PATCH(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const body = (await req.json()) as { id?: string }
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 })

  const supabase = createClient()
  const { error } = await supabase.rpc("provider_accounts_set_default", { p_id: body.id })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "provider_account.default_changed",
    p_resource: `provider_accounts:${body.id}`,
    p_after: { id: body.id },
  })
  return NextResponse.json({ ok: true })
}
