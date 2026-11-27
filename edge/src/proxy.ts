// The request the edge proxy sends to Supabase — pure, so it is tested without a Worker (edge/src/proxy.test.ts).

/** PayCraft Cloud's Supabase project. Clients never see this host: they call edge.paycraft.mobilebytesensei.com. */
export const UPSTREAM = "https://mlwfgytjxlqyfxcgpysm.supabase.co"

/** The Supabase APIs clients use. Anything else (studio, pg-meta, …) is not forwarded. */
const ALLOWED_PREFIXES = ["/rest/v1/", "/functions/v1/", "/auth/v1/", "/storage/v1/", "/realtime/v1/"]

export function isForwarded(pathname: string): boolean {
  return ALLOWED_PREFIXES.some((p) => pathname.startsWith(p))
}

/**
 * The upstream request: same method, headers and body, aimed at Supabase. X-Forwarded-For is REPLACED with the
 * caller's address as Cloudflare saw it — Supabase would otherwise see this Worker's IP, collapsing every per-IP rate
 * limit onto one key, and a client-supplied X-Forwarded-For would let a caller pick its own IP.
 */
export function upstreamRequest(request: Request, clientIp: string | null): Request {
  const url = new URL(request.url)
  const target = new URL(url.pathname + url.search, UPSTREAM)
  const out = new Request(target, request)
  out.headers.delete("x-forwarded-for")
  if (clientIp) out.headers.set("x-forwarded-for", clientIp)
  return out
}
