/**
 * POST /functions/v1/account-token
 *   Authorization: Bearer sk_acct_<b64url-32>
 *   → { access_token, token_type: "Bearer", expires_in: 900 }
 *
 * The headless half of onboarding. PayCraft's mutating RPCs all authorize on `auth.uid()` through
 * `tenant_admins`, so acting as an account previously required a human-held session. This exchanges
 * an account API key for a SHORT-LIVED JWT carrying `sub = owner_user_id` and `role = authenticated`
 * — which means every existing RPC, RLS policy and `auth.uid()` guard keeps working exactly as
 * audited, and the anon surface migrations 105/107 swept stays swept.
 *
 * Rejected alternatives, both of which would have widened that surface:
 *   - service_role from an edge function: bypasses RLS entirely, making this function the sole
 *     security boundary for every table it can reach.
 *   - a caller-supplied owner parameter on each RPC: caller-asserted identity is precisely the
 *     anti-pattern migration 107 existed to remove.
 *
 * NO THIRD-PARTY JWT LIBRARY. `stripe-connect-oauth/index.ts` records that a `deno.land/x` import in
 * the bundle path stopped that function deploying while the other 24 shipped; HS256 is a hash, a
 * concat and a base64url encode, and the platform's own WebCrypto has no version to rot.
 */

import { serve } from "https://deno.land/std@0.208.0/http/server.ts"
import { supabaseAdmin } from "../_shared/supabase-admin.ts"
import { hashKey, verifyKeyConstantTime } from "../_shared/account-key.ts"

/** AC-12 caps the lifetime at 900s. Short because the key can always mint another. */
const EXP_SECONDS = 900

function b64url(input: Uint8Array | string): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : input
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "")
}

/** HS256 JWT, signed with the SAME secret the Supabase gateway verifies incoming tokens against. */
async function mintJwt(payload: Record<string, unknown>, secret: string): Promise<string> {
  const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const body = b64url(JSON.stringify(payload))
  const signingInput = `${header}.${body}`
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(signingInput))
  return `${signingInput}.${b64url(new Uint8Array(sig))}`
}

serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method_not_allowed" }), {
      status: 405,
      headers: { "content-type": "application/json" },
    })
  }

  const jwtSecret = Deno.env.get("SUPABASE_JWT_SECRET")
  if (!jwtSecret) {
    // A configuration fault, not a credential fault — do not disguise it as a 401, or a broken
    // deploy looks identical to a wrong key and nobody goes looking at the environment.
    return new Response(JSON.stringify({ error: "server_misconfigured" }), {
      status: 500,
      headers: { "content-type": "application/json" },
    })
  }

  // EVERY refusal below returns the same generic `invalid_credentials` body. Distinguishing
  // "revoked" from "unknown" from "malformed" would hand a caller an oracle: it confirms which
  // keys ever existed, and turns a leaked-then-revoked key into a signal rather than a dead end.
  const deny = () =>
    new Response(JSON.stringify({ error: "invalid_credentials" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    })

  const auth = req.headers.get("authorization") ?? ""
  const m = auth.match(/^Bearer (sk_acct_[A-Za-z0-9_-]{20,})$/)
  if (!m) return deny()

  // Hash first, look up second — the work done before the database is reached is identical for a
  // well-formed key whether or not it exists.
  const hash = await hashKey(m[1])

  const { data: row, error } = await supabaseAdmin
    .from("account_api_keys")
    .select("id, owner_user_id, key_hash, revoked_at")
    .eq("key_hash", hash)
    .maybeSingle()

  if (error || !row) return deny()
  if (row.revoked_at !== null) return deny()
  // Redundant against an equality lookup, but it keeps the comparison honest if this ever becomes a
  // prefix lookup — and it costs one pass over 64 characters.
  if (!verifyKeyConstantTime(row.key_hash, hash)) return deny()

  const now = Math.floor(Date.now() / 1000)
  const token = await mintJwt(
    {
      sub: row.owner_user_id,
      role: "authenticated",
      aud: "authenticated",
      iat: now,
      exp: now + EXP_SECONDS,
    },
    jwtSecret,
  )

  // Best-effort: a failed touch must not deny a valid caller a token.
  await supabaseAdmin
    .from("account_api_keys")
    .update({ last_used_at: new Date(now * 1000).toISOString() })
    .eq("id", row.id)

  return new Response(
    JSON.stringify({ access_token: token, token_type: "Bearer", expires_in: EXP_SECONDS }),
    { status: 200, headers: { "content-type": "application/json" } },
  )
})
