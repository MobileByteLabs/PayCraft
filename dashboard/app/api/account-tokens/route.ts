import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"

export const dynamic = "force-dynamic"

/**
 * Session-authenticated CRUD for ACCOUNT-scoped access tokens (`pcsk_`, migration 150).
 *
 * THREE KEY TYPES, AND WHY THIS IS THE THIRD SCREEN
 *   • `pk_…`   — the app's PUBLIC SDK key. Ships inside every client binary by design.
 *   • `pcsk_…` app-scoped   (/api/developer-keys) — a secret reaching ONE app.
 *   • `pcsk_…` account-scoped (here) — a secret reaching EVERY app the signed-in owner administers.
 *
 * Separate screens are deliberate, for the same reason developer-keys is separate from the public
 * keys: one page showing several credential tiers invites pasting the wrong one into an app bundle.
 * This tier is the most dangerous of the three — it is the one to be most careful with.
 *
 * Reach is NOT stored. `tenant_api_key_verify` recomputes it from `tenant_admins` on every request,
 * so removing someone from an app removes their token's reach to it in the same instant. A stored
 * tenant list would keep granting access to an app the owner no longer administers.
 *
 * The plaintext is returned exactly once, by POST, and never again — only its SHA-256 hash is kept.
 */

/**
 * Scopes selectable here. Mirrors the CHECK constraint (migrations 136 + 150) and `ApiScope`.
 *
 * Read and write are listed separately rather than as a single "full access" toggle so the default
 * is genuinely nothing and each grant is a deliberate click — the same reason Supabase's own token
 * UI defaults every permission group to "No access".
 */
const SCOPES = [
  "readiness:read",
  "providers:read",
  "products:read",
  "products:sync",
  "tenant:read",
  "subscribers:read",
  "coupons:read",
  "paywall:read",
  "audit:read",
  "webhooks:read",
  "products:write",
  "paywall:write",
  "providers:write",
  "apps:read",
  "apps:provision",
  "keys:rotate",
] as const

/** Expiry is mandatory for this tier; the DB enforces it too (tenant_api_keys_account_expires). */
const MAX_DAYS = 365
const DEFAULT_DAYS = 30

export async function GET() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 })

  // Metadata only — there is no endpoint that returns a token, because one that could would undo
  // the reason for hashing them.
  const { data, error } = await supabase.rpc("account_api_keys_list")
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Show the operator what each token currently REACHES, computed the same way verification does.
  const { data: admined } = await supabase
    .from("tenant_admins")
    .select("tenant_id, tenants(name)")
    .eq("user_id", user.id)
    .in("role", ["owner", "admin"])

  return NextResponse.json({
    tokens: data ?? [],
    reaches: (admined ?? []).map((r: any) => ({ id: r.tenant_id, name: r.tenants?.name ?? null })),
    scopes: SCOPES,
  })
}

export async function POST(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 })

  const body = (await req.json().catch(() => ({}))) as {
    name?: string
    scopes?: string[]
    expires_in_days?: number
  }

  const name = (body.name ?? "").trim()
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })

  const scopes = (body.scopes ?? []).filter((s) => (SCOPES as readonly string[]).includes(s))
  if (!scopes.length) {
    // Never default to a scope. A token minted with an assumed permission is one nobody granted —
    // and this tier would assume it across every app on the account.
    return NextResponse.json({ error: "select at least one scope" }, { status: 400 })
  }

  const days = Number.isFinite(body.expires_in_days) ? Number(body.expires_in_days) : DEFAULT_DAYS
  if (days <= 0 || days > MAX_DAYS) {
    return NextResponse.json(
      { error: `expires_in_days must be between 1 and ${MAX_DAYS}` },
      { status: 400 },
    )
  }
  const expiresAt = new Date(Date.now() + days * 86_400_000).toISOString()

  const { data, error } = await supabase.rpc("account_api_key_create", {
    p_name: name,
    p_scopes: scopes,
    p_expires_at: expiresAt,
  })
  if (error) {
    // `no_administered_tenants` is a real, actionable state: a token that reaches nothing is a
    // misleading artefact, so creation refuses rather than minting one.
    const status = error.message?.includes("no_administered_tenants") ? 409 : 500
    return NextResponse.json({ error: error.message }, { status })
  }

  const row = Array.isArray(data) ? data[0] : data
  // `api_key` appears in this response and nowhere else, ever.
  return NextResponse.json({
    id: row?.id,
    api_key: row?.api_key,
    key_prefix: row?.key_prefix,
    expires_at: expiresAt,
    scopes,
    warning:
      "Copy this now — it is shown once. It reaches EVERY app you administer; treat it like a password.",
  })
}

export async function DELETE(req: Request) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const id = searchParams.get("id")
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 })

  // Scoped to the caller's own tokens by owner_user_id — a revoke cannot reach someone else's.
  const { error } = await supabase
    .from("tenant_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_user_id", user.id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ revoked: true })
}
