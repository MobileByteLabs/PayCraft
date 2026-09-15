import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { generateAccountKey, hashKey, keyPrefix } from "@/lib/account-key"

/**
 * Account API keys — issue, list, revoke.
 *
 * Account-scoped, not tenant-scoped, which is the whole point: one key acts for every app the
 * account owns, so `/idea-paycraft-onboard-*` can run headless across all four arrival paths
 * without a human session. The key is never a database credential — it is exchanged at
 * `functions/v1/account-token` for a 15-minute JWT carrying `sub = owner_user_id`, so every
 * existing RPC and RLS policy keeps working unchanged.
 *
 * The plaintext exists for exactly one response and is never stored, logged, or recoverable.
 * `account_api_keys` holds only a SHA-256 hash, and migration 118's `key_hash_is_sha256_hex` CHECK
 * makes a forgotten-to-hash insert impossible to persist.
 */

function fail(message: string, status = 500) {
  return NextResponse.json({ error: message }, { status })
}

/** POST — issue a key. The ONLY response that ever carries the plaintext. */
export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError || !auth?.user) return fail("not_authenticated", 401)

  const body = (await req.json().catch(() => ({}))) as { label?: string }

  const plaintext = generateAccountKey()
  const key_hash = await hashKey(plaintext)
  const key_prefix = keyPrefix(plaintext)

  const { data, error } = await supabase
    .from("account_api_keys")
    .insert({
      owner_user_id: auth.user.id,
      key_hash,
      key_prefix,
      label: typeof body.label === "string" && body.label.trim() ? body.label.trim() : null,
    })
    .select("id, key_prefix, label, created_at")
    .single()

  if (error) return fail(error.message)

  // Shown once. The caller is expected to hand it straight to the operator (who stores it in the
  // vault as `mbs-paycraft-account-key`) and drop it. There is no endpoint that can return it again
  // — a lost key is revoked and reissued, never recovered.
  return NextResponse.json({ ...data, plaintext, plaintext_shown_once: true }, { status: 201 })
}

/** GET — list keys as METADATA only. No column selected here can reconstruct a key. */
export async function GET() {
  const supabase = createClient()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError || !auth?.user) return fail("not_authenticated", 401)

  const { data, error } = await supabase
    .from("account_api_keys")
    .select("id, key_prefix, label, created_at, last_used_at, revoked_at")
    .eq("owner_user_id", auth.user.id)
    .order("created_at", { ascending: false })

  if (error) return fail(error.message)
  return NextResponse.json({ keys: data ?? [] })
}

/**
 * DELETE — revoke. Soft, not a row delete: `last_used_at` and `created_at` are the only record that
 * a credential ever existed, and destroying them would erase the audit trail at exactly the moment
 * it becomes interesting. The exchange endpoint refuses any row with `revoked_at` set.
 */
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get("id")
  if (!id) return fail("id is required", 400)

  const supabase = createClient()
  const { data: auth, error: authError } = await supabase.auth.getUser()
  if (authError || !auth?.user) return fail("not_authenticated", 401)

  // `owner_user_id` is matched explicitly as well as by RLS — defence in depth, so a policy
  // regression cannot turn this into a cross-account revoke.
  const { data, error } = await supabase
    .from("account_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("owner_user_id", auth.user.id)
    .is("revoked_at", null)
    .select("id, key_prefix, revoked_at")
    .maybeSingle()

  if (error) return fail(error.message)
  if (!data) return fail("not_found_or_already_revoked", 404)
  return NextResponse.json({ ok: true, ...data })
}
