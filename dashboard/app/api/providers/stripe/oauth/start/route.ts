import { NextResponse } from "next/server"
import { requireTenant } from "@/lib/tenant"
import { makeState } from "@/lib/stripe-oauth-state"
import { getPlatformConnectClientId } from "@/lib/stripe-client"

const DASHBOARD_URL =
  process.env.NEXT_PUBLIC_PAYCRAFT_DASHBOARD_URL ?? "http://localhost:3000"
const REDIRECT_URI = `${DASHBOARD_URL}/api/providers/stripe/oauth/callback`

/**
 * GET — kicks off the Stripe Connect OAuth flow. Resolves the platform's
 * `client_id` from `platform_secrets` (set via /admin/platform-keys) first,
 * falling back to the `STRIPE_CONNECT_CLIENT_ID` env var. When neither is
 * present the route returns 503 with an actionable error the dashboard surfaces.
 */
export async function GET() {
  const clientId = await getPlatformConnectClientId()
  if (!clientId) {
    return NextResponse.json(
      {
        error: "platform_not_configured",
        message:
          "Stripe Connect platform credentials missing — configure them at /admin/platform-keys.",
      },
      { status: 503 },
    )
  }
  const { tenant } = await requireTenant()
  const state = makeState(tenant.id)

  const url = new URL("https://connect.stripe.com/oauth/authorize")
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", clientId)
  url.searchParams.set("scope", "read_write")
  url.searchParams.set("redirect_uri", REDIRECT_URI)
  url.searchParams.set("state", state)
  return NextResponse.redirect(url.toString())
}

/**
 * HEAD — availability probe used by /providers/stripe to decide whether to
 * render the OAuth tab or auto-default to Manual keys. 200 = OAuth wired,
 * 503 = platform credentials missing.
 */
export async function HEAD() {
  const clientId = await getPlatformConnectClientId()
  if (!clientId) return new NextResponse(null, { status: 503 })
  return new NextResponse(null, { status: 200 })
}
