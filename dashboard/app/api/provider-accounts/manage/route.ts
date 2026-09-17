export const runtime = "edge"

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"

/**
 * Account-level connection management: list / rename / set-default / delete.
 *
 * Deliberately NOT under a tenant. Every other provider route resolves `requireTenant()` first
 * because it is acting on one app; these act on the operator's own connections, which outlive any
 * single app and are shared across all of them. Scoping this to the bound tenant would have made
 * the page show a different set depending on which app you happened to have open — for data that
 * has nothing to do with that app.
 *
 * Authorisation is the RPCs' own: every one of them keys on `auth.uid()`, and the mutating three
 * additionally require ownership. The route adds no checks of its own, so there is no second
 * opinion to drift out of step with the first.
 */

/** Map a raise from the RPC layer onto a status the UI can act on rather than just display. */
function rpcError(message: string): NextResponse {
  const inUse = /connection_in_use:(\d+)/.exec(message)
  if (inUse) {
    return NextResponse.json(
      { error: "connection_in_use", appsUsing: Number(inUse[1]) },
      { status: 409 },
    )
  }
  if (message.includes("forbidden_connection")) {
    return NextResponse.json({ error: "That connection is not yours to change." }, { status: 403 })
  }
  if (message.includes("label_required")) {
    return NextResponse.json({ error: "A name is required." }, { status: 400 })
  }
  if (message.includes("forbidden")) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 })
  }
  return NextResponse.json({ error: message }, { status: 500 })
}

export async function GET() {
  const supabase = createClient()
  const { data, error } = await supabase.rpc("provider_accounts_list_all")
  if (error) return rpcError(error.message)
  return NextResponse.json({ connections: data ?? [] })
}

export async function PATCH(req: NextRequest) {
  const body = (await req.json()) as { id?: string; label?: string; makeDefault?: boolean }
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 })

  const supabase = createClient()

  if (body.makeDefault) {
    const { error } = await supabase.rpc("provider_accounts_set_default", { p_id: body.id })
    if (error) return rpcError(error.message)
  }
  if (typeof body.label === "string") {
    const { error } = await supabase.rpc("provider_accounts_rename", {
      p_id: body.id,
      p_label: body.label,
    })
    if (error) return rpcError(error.message)
  }
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

  const supabase = createClient()
  const { error } = await supabase.rpc("provider_accounts_delete", { p_id: id })
  if (error) return rpcError(error.message)
  return NextResponse.json({ ok: true })
}
