// supabase/functions/stripe-connect-oauth/index.ts
// Stripe Connect OAuth redirect handler.
//
// GET /functions/v1/stripe-connect-oauth?code=<code>&state=<tenant_id>.<hmac>
//   → exchanges code → access_token → encrypts → upserts tenant_stripe_connect → redirects
//
// State is HMAC-signed to prevent CSRF. On success redirects to dashboard /providers.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import Stripe from "https://esm.sh/stripe@14.21.0?target=deno"
import { hmac } from "https://deno.land/x/hmac@v2.0.1/mod.ts"

serve(async (req: Request): Promise<Response> => {
  const url = new URL(req.url)
  const code = url.searchParams.get("code")
  const state = url.searchParams.get("state")
  if (!code || !state) {
    return new Response("missing code or state", { status: 400 })
  }

  // State format: <tenant_id>.<hmac-sha256-16chars-hex>
  const dot = state.lastIndexOf(".")
  if (dot < 0) {
    return new Response("malformed state", { status: 400 })
  }
  const tenantId = state.substring(0, dot)
  const sig = state.substring(dot + 1)
  const expectedSig = hmac(
    "sha256",
    Deno.env.get("PAYCRAFT_OAUTH_STATE_SECRET")!,
    tenantId,
    "utf8",
    "hex",
  ).toString().substring(0, 16)
  if (sig !== expectedSig) {
    return new Response("state signature mismatch (CSRF)", { status: 403 })
  }

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
