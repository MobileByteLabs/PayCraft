import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { checkEdgeRateLimit, extractIp, rateLimitHeaders } from "@/lib/edge-rate-limit"

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

export async function middleware(request: NextRequest) {
  // Phase 4 — per-IP rate limit on mutating /api/* requests. Webhooks have
  // their own server-side authoritative limit via supabase/functions/_shared
  // /rate-limit.ts; this is the cheap edge shed for abusive bursts before
  // they hit our application code.
  if (
    request.nextUrl.pathname.startsWith("/api/") &&
    MUTATING_METHODS.has(request.method)
  ) {
    const ip = extractIp(request.headers)
    const outcome = checkEdgeRateLimit(ip)
    if (!outcome.ok) {
      return new NextResponse(
        JSON.stringify({ error: "rate_limit_exceeded", reset_at: outcome.resetAt }),
        {
          status: 429,
          headers: {
            "Content-Type": "application/json",
            "Retry-After": String(outcome.resetAt - Math.floor(Date.now() / 1000)),
            ...rateLimitHeaders(outcome),
          },
        },
      )
    }
  }

  let response = NextResponse.next({ request: { headers: request.headers } })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: Array<{ name: string; value: string; options?: Record<string, unknown> }>) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          )
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          )
        },
      },
    },
  )

  // Refresh the session — sets new cookies if access token expired.
  await supabase.auth.getUser()

  return response
}

export const config = {
  matcher: [
    // Run on every path except static assets + favicon
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
