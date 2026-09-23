import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"

export const dynamic = "force-dynamic"

/**
 * Session-authenticated CRUD for MANAGEMENT keys (`pcsk_`).
 *
 * Distinct from /settings/api-keys, which shows the tenant's PUBLIC `pk_` SDK keys. Those are
 * embedded in every shipped client by design; these are secrets that can bulk-write to live payment
 * providers. Keeping them on separate screens is deliberate — one page showing both invites someone
 * to paste the wrong one into an app bundle.
 *
 * Creation goes through `tenant_api_key_create`, which generates the key server-side and stores only
 * its SHA-256 hash. The plaintext is returned exactly once, here, and never again.
 */

const SCOPES = ["readiness:read", "providers:read", "products:read", "products:sync"] as const

export async function GET() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  // Metadata only. There is no endpoint that returns a key, because one that could would undo the
  // reason for hashing them.
  const { data, error } = await supabase
    .from("tenant_api_keys")
    .select("id, name, key_prefix, scopes, created_at, last_used_at, expires_at, revoked_at")
    .eq("tenant_id", tenant.id)
    .order("created_at", { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ keys: data ?? [] })
}

export async function POST(req: Request) {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const body = (await req.json().catch(() => ({}))) as { name?: string; scopes?: string[] }
  const name = (body.name ?? "").trim()
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })

  const scopes = (body.scopes ?? []).filter((s) => (SCOPES as readonly string[]).includes(s))
  if (!scopes.length) {
    // Never default to a scope. A key minted with an assumed permission is one nobody chose to grant.
    return NextResponse.json({ error: "select at least one scope" }, { status: 400 })
  }

  const { data, error } = await supabase.rpc("tenant_api_key_create", {
    p_tenant_id: tenant.id,
    p_name: name,
    p_scopes: scopes,
    p_expires_at: null,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const row = Array.isArray(data) ? data[0] : data
  // `api_key` appears in this response and nowhere else, ever.
  return NextResponse.json({ id: row?.id, api_key: row?.api_key, key_prefix: row?.key_prefix })
}

export async function DELETE(req: Request) {
  await requireTenant()
  const supabase = createClient()

  const id = new URL(req.url).searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

  // The RPC re-checks tenant ownership itself, so a forged id belonging to another tenant is
  // refused there rather than trusted here.
  const { error } = await supabase.rpc("tenant_api_key_revoke", { p_id: id })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
