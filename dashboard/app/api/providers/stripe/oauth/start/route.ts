import { NextResponse } from "next/server"
import { requireTenant } from "@/lib/tenant"
import { makeState } from "@/lib/stripe-oauth-state"

const CLIENT_ID = process.env.STRIPE_CONNECT_CLIENT_ID
const DASHBOARD_URL = process.env.NEXT_PUBLIC_PAYCRAFT_DASHBOARD_URL ?? "http://localhost:3000"
const REDIRECT_URI = `${DASHBOARD_URL}/api/providers/stripe/oauth/callback`

export async function GET() {
  if (!CLIENT_ID) {
    return NextResponse.json(
      { error: "STRIPE_CONNECT_CLIENT_ID not configured on server" },
      { status: 500 },
    )
  }
  const { tenant } = await requireTenant()
  const state = makeState(tenant.id)

  const url = new URL("https://connect.stripe.com/oauth/authorize")
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", CLIENT_ID)
  url.searchParams.set("scope", "read_write")
  url.searchParams.set("redirect_uri", REDIRECT_URI)
  url.searchParams.set("state", state)
  // Pre-select the country if you want — Stripe will let user change.
  return NextResponse.redirect(url.toString())
}
