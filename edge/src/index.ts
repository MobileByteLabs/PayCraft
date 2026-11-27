// edge.paycraft.mobilebytesensei.com — the only address PayCraft's SDKs and dashboard use for Supabase.
//
// What it buys: Cloudflare's WAF / rate limiting in front of every call, the Supabase project address kept out of
// clients, and a backend that can move without an app update. What it does not: replace RLS — the public anon key
// still works directly against supabase.co (Supabase cannot restrict API access by origin), so RLS and the RPCs'
// own checks remain the protection. Placed in Tokyo next to the database (wrangler.jsonc), so the extra hop is short.
// WebSockets (realtime) pass through: fetch() of an Upgrade request returns the upstream 101 with its socket.
import { isForwarded, upstreamRequest } from "./proxy.ts"

const worker = {
  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)
    if (!isForwarded(pathname)) {
      return Response.json({ error: "not_found", detail: "This host serves the PayCraft API only." }, { status: 404 })
    }
    return fetch(upstreamRequest(request, request.headers.get("cf-connecting-ip")))
  },
}

export default worker
