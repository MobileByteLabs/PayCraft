// supabase/functions/_shared/__tests__/cors.test.ts
//
// The browser contract for every edge function a website calls (config, identity-token,
// checkout-initiate — cmp-paycraft-web). A browser sends a preflight before any cross-origin POST
// carrying `apikey` / `authorization`; if that OPTIONS is answered with 405, or the real response
// lacks `access-control-allow-origin`, the website sees a CORS error and never reaches the function.
//
// Run: deno test --allow-env supabase/functions/_shared/__tests__/cors.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { CORS_HEADERS, preflight, withCors } from "../cors.ts"

Deno.test("OPTIONS → 204 allowing every header the SDKs send", () => {
  const r = preflight(new Request("https://x/functions/v1/config", { method: "OPTIONS" }))
  assertEquals(r?.status, 204)
  const allowed = r!.headers.get("access-control-allow-headers") ?? ""
  for (const h of ["authorization", "apikey", "content-type", "x-paycraft-mode", "x-paycraft-platform"]) {
    assertEquals(allowed.includes(h), true, `missing ${h}`)
  }
  assertEquals(r!.headers.get("access-control-allow-methods")?.includes("POST"), true)
  assertEquals(r!.headers.get("access-control-allow-origin"), "*")
})

Deno.test("non-OPTIONS requests are not answered by the preflight", () => {
  assertEquals(preflight(new Request("https://x", { method: "GET" })), null)
  assertEquals(preflight(new Request("https://x", { method: "POST", body: "{}" })), null)
})

Deno.test("withCors adds the headers to error responses and keeps status + body + content-type", async () => {
  const r = withCors(new Response('{"error":"bad"}', { status: 400, headers: { "content-type": "application/json" } }))
  assertEquals(r.status, 400)
  assertEquals(r.headers.get("access-control-allow-origin"), "*")
  assertEquals(r.headers.get("content-type"), "application/json")
  assertEquals(await r.text(), '{"error":"bad"}')
})

Deno.test("withCors keeps a redirect's Location (identity-token /start answers 302)", () => {
  const r = withCors(new Response(null, { status: 302, headers: { location: "https://accounts.google.com/" } }))
  assertEquals(r.status, 302)
  assertEquals(r.headers.get("location"), "https://accounts.google.com/")
  assertEquals(r.headers.get("access-control-allow-origin"), CORS_HEADERS["access-control-allow-origin"])
})
