import { NextResponse } from "next/server"

/**
 * PATCH body handler shared by /api/account-tokens and /api/developer-keys: replace an existing
 * pcsk_ key's scopes in place via `api_key_set_scopes` (migration 174). The key VALUE is unchanged.
 *
 * Scopes are filtered against the calling route's own list exactly like its POST does, so a route
 * can never grant a scope it would refuse at creation. Ownership is decided by the RPC, not here.
 */

/** RPC error → HTTP status. 'forbidden' covers "not yours" AND "no such key" by design (no oracle). */
const STATUS: Record<string, number> = {
  unauthenticated: 401,
  forbidden: 403,
  key_not_active: 409,
  scopes_required: 400,
  unknown_scope: 400,
}

export async function patchKeyScopes(
  req: Request,
  supabase: { rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }> },
  allowed: readonly string[],
) {
  const body = (await req.json().catch(() => ({}))) as { id?: string; scopes?: string[] }
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 })

  const scopes = (Array.isArray(body.scopes) ? body.scopes : []).filter((s) => allowed.includes(s))
  if (!scopes.length) return NextResponse.json({ error: "select at least one scope" }, { status: 400 })

  const { data, error } = await supabase.rpc("api_key_set_scopes", { p_id: body.id, p_scopes: scopes })
  if (error) {
    const code = Object.keys(STATUS).find((c) => error.message?.includes(c))
    return NextResponse.json({ error: error.message }, { status: code ? STATUS[code] : 500 })
  }
  return NextResponse.json({ id: body.id, scopes: data ?? scopes })
}
