// supabase/functions/stripe-connect-oauth/index.ts
// Stripe Connect OAuth redirect handler.
//
// GET /functions/v1/stripe-connect-oauth?code=<code>&state=<base64url(tenantId:ts:sig)>
//   → exchanges code → access_token → encrypts → upserts tenant_stripe_connect → redirects
//
// State is HMAC-signed to prevent CSRF, and time-boxed. On success redirects to dashboard /providers.
//
// ## The format this function used to expect did not exist
// It parsed `<tenant_id>.<16-hex>` — no timestamp, signature truncated to 16 characters, dot
// separated. The dashboard has never sent that: `lib/stripe-oauth-state.ts#makeState` emits
// `base64url(tenantId:ts:sig)` with a FULL-length signature, verified against a 10-minute window.
// So this handler could not have verified a single real callback; it would reject every genuine
// Stripe redirect as a CSRF attempt. It went unnoticed because the function had also stopped
// DEPLOYING (its `deno.land/x/hmac` dependency reaches denopkg.com, which the Supabase bundler
// refuses) — a deploy failure hid a correctness failure.
//
// The verification below mirrors `dashboard/lib/stripe-oauth-state.ts#verifyState` exactly: same
// payload shape, same full-length comparison, same max age.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno"

/**
 * HMAC-SHA256 → lowercase hex, via the Web Crypto API Deno ships with.
 *
 * This used to be `deno.land/x/hmac@v2.0.1`, whose own deps reach **denopkg.com** — a host the
 * Supabase bundler now refuses ("Requires import access to denopkg.com"), so this function silently
 * stopped deploying while the other 24 shipped. Deploying it with `--allow-import` would have
 * "fixed" it by permitting a third-party host to sit in the bundle path of a CSRF check; the
 * platform's own crypto has no such dependency and no version to rot.
 */
async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  )
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message))
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
}

/**
 * Compare two signatures without leaking WHERE they differ.
 *
 * `a !== b` returns as soon as it finds a mismatched byte, so the time it takes reveals how much of
 * a guess was correct — enough to walk a forged signature into place one character at a time. This
 * is the check standing between a stranger and a tenant's Stripe connection, so it runs in time
 * proportional to the length and nothing else.
 */
function timingSafeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a)
  const eb = new TextEncoder().encode(b)
  const len = Math.max(ea.length, eb.length)
  let diff = ea.length ^ eb.length
  for (let i = 0; i < len; i++) diff |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
  return diff === 0
}

/**
 * Verify the `state` the dashboard signed — the mirror of
 * `dashboard/lib/stripe-oauth-state.ts#verifyState`.
 *
 * Kept deliberately identical to that function rather than "close enough": the two sit on opposite
 * sides of an OAuth round-trip, and any disagreement about padding, separator or max age means
 * every genuine Stripe callback is rejected as forged — which is exactly the state this handler
 * was already in.
 */
async function verifyState(
  state: string,
  maxAgeMs = 600_000,
): Promise<{ tenantId: string } | null> {
  try {
    let b64 = state.replace(/-/g, "+").replace(/_/g, "/")
    b64 += "=".repeat((4 - (b64.length % 4)) % 4)
    const decoded = atob(b64)
    const parts = decoded.split(":")
    if (parts.length !== 3) return null
    const [tenantId, ts, sig] = parts
    const expected = await hmacSha256Hex(
      Deno.env.get("PAYCRAFT_OAUTH_STATE_SECRET")!,
      `${tenantId}:${ts}`,
    )
    if (!timingSafeEqual(sig, expected)) return null
    if (Date.now() - parseInt(ts, 10) > maxAgeMs) return null
    return { tenantId }
  } catch {
    return null
  }
}

serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  if (!code || !state) {
    return new Response("missing code or state", { status: 400 })
  }

  // State: base64url(`${tenantId}:${ts}:${sig}`) — the shape makeState() emits.
  const verified = await verifyState(state)
  if (!verified) {
    // One message for "not ours", "tampered" and "expired" on purpose: telling an attacker WHICH
    // of the three failed hands them a way to probe the signature and the clock separately.
    return new Response("state signature mismatch (CSRF)", { status: 403 })
  }
  const tenantId = verified.tenantId

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  )
  const stripe = new Stripe(
    Deno.env.get("PAYCRAFT_PLATFORM_STRIPE_SECRET_KEY")!,
    { apiVersion: "2024-06-20" },
  )

  let tokenResp: Stripe.OAuthToken
  try {
    tokenResp = await stripe.oauth.token({
      grant_type: "authorization_code",
      code,
    })
  } catch (e) {
    return new Response(
      JSON.stringify({ error: "oauth_exchange_failed", detail: String(e) }),
      { status: 500, headers: { "content-type": "application/json" } },
    )
  }

  const { error } = await supabase.rpc("tenant_stripe_connect_upsert", {
    p_tenant_id: tenantId,
    p_account_id: tokenResp.stripe_user_id,
    p_access_token: tokenResp.access_token,
    p_refresh_token: tokenResp.refresh_token ?? null,
    p_livemode: tokenResp.livemode,
    p_scope: tokenResp.scope,
    p_encryption_key: Deno.env.get("PAYCRAFT_TOKEN_ENCRYPTION_KEY")!,
  })
  if (error) {
    return new Response(
      JSON.stringify({ error: "store_failed", detail: error.message }),
      { status: 500, headers: { "content-type": "application/json" } },
    )
  }

  // Audit log
  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenantId,
    p_actor_user_id: null,
    p_actor_type: "system",
    p_action: "stripe.connect.linked",
    p_resource: `tenant_stripe_connect:tenant_id=${tenantId}`,
    p_after: {
      stripe_user_id: tokenResp.stripe_user_id,
      livemode: tokenResp.livemode,
    },
    p_ip: req.headers.get("x-forwarded-for"),
    p_user_agent: req.headers.get("user-agent"),
  })

  return Response.redirect(
    `${Deno.env.get("PAYCRAFT_DASHBOARD_URL")}/providers?connected=stripe`,
    302,
  )
})
