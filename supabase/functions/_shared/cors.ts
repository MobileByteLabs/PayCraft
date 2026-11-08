// supabase/functions/_shared/cors.ts
//
// CORS for the edge functions a WEBSITE calls directly (cmp-paycraft-web): `config`,
// `identity-token`, `checkout-initiate`. One header set so no function drifts from the others —
// before this helper only checkout-initiate answered a preflight, and it omitted `apikey` and
// `x-paycraft-mode`, both of which the SDKs send.
//
// Origin `*` on purpose: these endpoints are keyed by the tenant's PUBLISHABLE key (shipped in
// every app binary and web page), no cookies or credentials are involved, and a per-origin
// allowlist would not stop a non-browser client anyway. Rate limits stay the abuse control.
//
// Usage inside a handler:
//   const pre = preflight(req); if (pre) return pre;     // first line
//   return withCors(response);                           // every response, errors included

export const CORS_HEADERS: Readonly<Record<string, string>> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers":
    "authorization, apikey, content-type, x-paycraft-mode, x-paycraft-platform, x-paycraft-country-provenance, accept-language",
  "access-control-max-age": "86400",
}

/** Answers a CORS preflight (OPTIONS → 204); returns null for every other method. */
export function preflight(req: Request): Response | null {
  return req.method === "OPTIONS" ? new Response(null, { status: 204, headers: { ...CORS_HEADERS } }) : null
}

/** Returns the response with the CORS headers added; status, body and other headers unchanged. */
export function withCors(res: Response): Response {
  const headers = new Headers(res.headers)
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v)
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers })
}
