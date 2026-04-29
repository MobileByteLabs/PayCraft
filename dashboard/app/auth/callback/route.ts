import { createClient } from "@/lib/supabase-server"
import { NextRequest, NextResponse } from "next/server"

/**
 * Auth callback — handles email confirmation redirect.
 * After confirming, auto-provisions tenant if user doesn't have one.
 * Sends welcome email on first sign-up.
 */
export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")

  if (code) {
    const supabase = createClient()
    await supabase.auth.exchangeCodeForSession(code)

    const { data: { session } } = await supabase.auth.getSession()

    if (session) {
      // Check if user already has a tenant
      const { data: existing } = await supabase
        .from("tenant_admins")
        .select("tenant_id")
        .eq("user_id", session.user.id)
        .single()

      if (!existing) {
        // Auto-provision tenant
        const appName = session.user.user_metadata?.app_name || "My App"
        const { data: tenant } = await supabase.rpc("provision_tenant", {
          p_user_id: session.user.id,
          p_app_name: appName,
          p_email: session.user.email,
        })

        // Send welcome email (fire-and-forget)
        if (tenant && session.user.email) {
          fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-welcome`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
            },
            body: JSON.stringify({
              tenant_id: tenant.tenant_id || tenant,
              email: session.user.email,
              app_name: appName,
            }),
          }).catch(() => { /* welcome email is best-effort */ })
        }
      }
    }
  }

  return NextResponse.redirect(new URL("/subscribers", request.url))
}
