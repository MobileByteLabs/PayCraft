export const runtime = "edge"

import { createServerClient, type CookieOptions } from "@supabase/ssr"
import { NextRequest, NextResponse } from "next/server"

/**
 * Expire every PKCE `code-verifier` cookie once the exchange has consumed it.
 *
 * `signInWithOAuth` writes a verifier cookie (`sb-<ref>-auth-token-flow-<hash>-code-verifier`,
 * plus the index cookie `…-flows-code-verifier`) and `exchangeCodeForSession` spends it. Nothing
 * deleted them afterwards, so they lingered with the token's ~400-day expiry — observed live on
 * BOTH localhost and paycraft.mobilebytesensei.com after a successful sign-in.
 *
 * Why that matters beyond tidiness: a spent verifier is exactly the "stale artifact" the login
 * page's own purge routine exists to defend against — supabase-js may treat a leftover as current
 * on the NEXT flow and GoTrue answers `{"message":"Bad request"}`. That purge only runs when the
 * user happens to LAND on /auth/login; a flow started anywhere else still inherits the garbage.
 * Deleting at the point of consumption fixes it for every entry path.
 *
 * Every accumulated verifier is removed, not just this flow's: abandoned attempts (cancelled at
 * Google, network blip mid-exchange) leave their own, and they are equally spent.
 */
function clearSpentPkceVerifiers(request: NextRequest, response: NextResponse) {
  for (const { name } of request.cookies.getAll()) {
    if (!name.startsWith("sb-") || !name.includes("code-verifier")) continue
    // maxAge 0 + matching path is what actually removes it; `delete` alone can miss a cookie
    // whose attributes differ from the default the framework assumes.
    response.cookies.set({ name, value: "", path: "/", maxAge: 0 })
  }
}

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
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
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
    // A FAILED exchange leaves the verifier behind too, and that stale value is precisely what
    // poisons the retry the user is about to make. Clear it on the way back to /auth/login.
    const failed = NextResponse.redirect(
      new URL(`/auth/login?error=${encodeURIComponent(error.message)}`, origin)
    )
    clearSpentPkceVerifiers(request, failed)
    return failed
  }

  // The code has been spent — drop its verifier cookies before any branch returns.
  clearSpentPkceVerifiers(request, response)

  // Route first-time sign-ins to /onboarding so the user names the app.
  // Returning users with at least one tenant_admins row go to the dashboard
  // (the previous default — /subscribers).
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    // Does the user admin AT LEAST ONE tenant? `.limit(1).maybeSingle()` returns the first
    // membership (or null) and — unlike a bare `.maybeSingle()` — does NOT error when the user
    // owns multiple tenants. The bare form threw for any ≥2-tenant owner, making `existing` null
    // and wrongly bouncing returning multi-tenant admins to /onboarding on every login.
    const { data: existing } = await supabase
      .from("tenant_admins")
      .select("tenant_id")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle()

    if (!existing) {
      return NextResponse.redirect(new URL("/onboarding", origin), { headers: response.headers })
    }
  }

  return response
}