import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"
import { checkEdgeRateLimit, extractIp, rateLimitHeaders } from "@/lib/edge-rate-limit"
import { API_HOSTS, MCP_HOSTS } from "@/lib/hosts"

const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"])

export async function middleware(request: NextRequest) {
  const host = request.headers.get("host")?.toLowerCase() ?? ""

  if (MCP_HOSTS.has(host)) {
    const { pathname } = request.nextUrl
    if (pathname === "/" || pathname === "" || pathname === "/mcp") {
      const url = request.nextUrl.clone()
      // Same origin, two audiences. A browser GET is a person trying to find out what this is and
      // how to connect; a POST is a client speaking JSON-RPC. Answering the browser with the
      // transport's prescribed 405 would be correct and useless.
      url.pathname = request.method === "GET" ? "/api/mcp/home" : "/api/mcp"
      return NextResponse.rewrite(url)
    }
    if (!pathname.startsWith("/api/mcp")) {
      return NextResponse.json(
        { error: "not_found", detail: "This host serves the MCP endpoint at / only." },
        { status: 404 },
      )
    }
  }

  if (API_HOSTS.has(host)) {
    const { pathname } = request.nextUrl
    // Only the versioned prefix is exposed. Anything else on this host is not part of the API and
    // must not fall through to the dashboard UI — an api.* origin serving a login page invites
    // someone to trust it with a session it was never meant to hold.
    // The root serves the developer portal. It used to return a JSON service descriptor, which is
    // the correct answer for a machine and the wrong one for the person who typed the hostname into
    // a browser to find out what it is.
    if (pathname === "/" || pathname === "") {
      const url = request.nextUrl.clone()
      url.pathname = "/api/v1/home"
      return NextResponse.rewrite(url)
    }
    if (pathname.startsWith("/v1/")) {
      const url = request.nextUrl.clone()
      url.pathname = `/api${pathname}`
      return NextResponse.rewrite(url)
    }
    if (!pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "not_found", detail: "this host serves /v1/* only" }, { status: 404 })
    }
  }

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
    "/((?!_next/static|_next/image|_spa/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
}
