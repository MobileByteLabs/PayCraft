import { NextRequest, NextResponse } from "next/server"
import Stripe from "stripe"
import { createClient } from "@/lib/supabase-server"
import { verifyState } from "@/lib/stripe-oauth-state"
import { getPlatformStripeClient } from "@/lib/stripe-client"

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const DASHBOARD_URL = process.env.NEXT_PUBLIC_PAYCRAFT_DASHBOARD_URL ?? "http://localhost:3000"

const STRIPE_WEBHOOK_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_succeeded",
  "invoice.payment_failed",
  "checkout.session.completed",
]

export async function GET(req: NextRequest) {
  const code = req.nextUrl.searchParams.get("code")
  const state = req.nextUrl.searchParams.get("state")
  const errParam = req.nextUrl.searchParams.get("error")

  if (errParam) {
    return NextResponse.redirect(`${DASHBOARD_URL}/providers/stripe?error=${encodeURIComponent(errParam)}`)
  }
  if (!code || !state) {
    return NextResponse.redirect(`${DASHBOARD_URL}/providers/stripe?error=missing_params`)
  }

  const verified = verifyState(state)
  if (!verified) {
    return NextResponse.redirect(`${DASHBOARD_URL}/providers/stripe?error=invalid_state`)
  }

  // 1. Exchange code → tokens via the platform key. `getPlatformStripeClient`
  // is now async (reads from `platform_secrets` first, env var fallback).
  let tokenResp: Stripe.OAuthToken
  try {
    const platform = await getPlatformStripeClient()
    tokenResp = await platform.oauth.token({ grant_type: "authorization_code", code })
  } catch (e: any) {
    const msg = String(e?.message ?? "unknown")
    // Detect the specific "Stripe Connect not enabled" case so the dashboard
    // can render an actionable hint (link to dashboard.stripe.com/settings/connect).
    if (msg.toLowerCase().includes("not enabled") || msg.toLowerCase().includes("connect")) {
      return NextResponse.redirect(
        `${DASHBOARD_URL}/providers/stripe?error=connect_disabled:${encodeURIComponent(msg)}`,
      )
    }
    return NextResponse.redirect(
      `${DASHBOARD_URL}/providers/stripe?error=token_exchange:${encodeURIComponent(msg)}`,
    )
  }

  if (!tokenResp.access_token || !tokenResp.refresh_token || !tokenResp.stripe_user_id) {
    return NextResponse.redirect(`${DASHBOARD_URL}/providers/stripe?error=incomplete_token`)
  }

  // 2. Persist (encrypted) via SECURITY DEFINER RPC.
  const supabase = createClient()
  const { error: persistErr } = await supabase.rpc("tenant_stripe_connect_save", {
    p_tenant_id: verified.tenantId,
    p_stripe_account_id: tokenResp.stripe_user_id,
    p_access_token: tokenResp.access_token,
    p_refresh_token: tokenResp.refresh_token,
    p_livemode: tokenResp.livemode ?? false,
    p_scope: tokenResp.scope ?? "read_write",
  })
  if (persistErr) {
    return NextResponse.redirect(`${DASHBOARD_URL}/providers/stripe?error=persist:${encodeURIComponent(persistErr.message)}`)
  }

  // 3. Register webhook endpoint on the connected account.
  try {
    const connected = new Stripe(tokenResp.access_token, { apiVersion: "2024-11-20.acacia" })
    const webhookUrl = `${SUPABASE_URL}/functions/v1/stripe-webhook/${verified.tenantId}`
    const we = await connected.webhookEndpoints.create({
      url: webhookUrl,
      enabled_events: STRIPE_WEBHOOK_EVENTS,
    })
    await supabase.rpc("tenant_stripe_connect_set_webhook", {
      p_tenant_id: verified.tenantId,
      p_webhook_endpoint_id: we.id,
    })
  } catch (e: any) {
    // Non-fatal — connection succeeded; webhook registration retryable from disconnect-reconnect.
    console.error("[stripe-oauth-callback] webhook registration failed:", e.message)
  }

  return NextResponse.redirect(`${DASHBOARD_URL}/providers/stripe?connected=1`)
}
