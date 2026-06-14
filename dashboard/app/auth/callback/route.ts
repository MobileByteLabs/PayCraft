import { createServerClient } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"

export async function GET(request: NextRequest) {
  const requestUrl = new URL(request.url)
  const code = requestUrl.searchParams.get("code")
  const origin = requestUrl.origin

  if (!code) {
    return NextResponse.redirect(new URL("/auth/login", origin))
  }

  // Create the redirect response FIRST so auth cookies land on this exact
  // response object — not on a separate cookieStore that won't transfer.
  const response = NextResponse.redirect(new URL("/subscribers", origin))

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => {
            request.cookies.set(name, value)
            response.cookies.set({ name, value, ...options })
          })
        },
      },
    },
  )

  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    console.error("[auth/callback] exchangeCodeForSession failed:", error.message)
    return NextResponse.redirect(
      new URL(`/auth/login?error=${encodeURIComponent(error.message)}`, origin)
    )
  }

  // Auto-provision tenant on first sign-in
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const { data: existing } = await supabase
      .from("tenant_admins")
      .select("tenant_id")
      .eq("user_id", user.id)
      .single()

    if (!existing) {
      const meta = user.user_metadata ?? {}
      const appName = meta.app_name || meta.full_name || meta.name || "My App"
      const { data: tenant, error: rpcError } = await supabase.rpc("provision_tenant", {
        p_user_id: user.id,
        p_app_name: appName,
        p_email: user.email,
      })

      if (rpcError) {
        console.error("[auth/callback] provision_tenant failed:", rpcError.message)
      }

      if (tenant && user.email) {
        fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/send-welcome`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
          body: JSON.stringify({
            tenant_id: tenant.tenant_id || tenant,
            email: user.email,
            app_name: appName,
          }),
        }).catch(() => { /* welcome email is best-effort */ })
      }
    }
  }

  return response
}
