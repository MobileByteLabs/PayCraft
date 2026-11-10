// supabase/functions/_shared/__tests__/cors-wiring.test.ts
//
// The three edge functions a website calls (cmp-paycraft-web) must answer the browser's CORS
// preflight and carry `access-control-allow-origin` on EVERY response — including errors, which a
// browser otherwise reports as an opaque CORS failure instead of the function's real error.
// Only paths that return before any database call are exercised, so no network or stubs are needed.
//
// Run: deno test --allow-env --allow-net supabase/functions/_shared/__tests__/cors-wiring.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"

Deno.env.set("CONFIG_SKIP_SERVE", "1")
Deno.env.set("IDENTITY_TOKEN_SKIP_SERVE", "1")
// _shared/supabase-admin.ts builds its client at import time; these stubs are never contacted
// because every path exercised below returns before a database call.
if (!Deno.env.get("SUPABASE_URL")) Deno.env.set("SUPABASE_URL", "http://127.0.0.1:54321")
if (!Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")) Deno.env.set("SUPABASE_SERVICE_ROLE_KEY", "stub-service-role-key")

const { handleConfigRequest } = await import("../../config/index.ts")
const { handleIdentityTokenRequest } = await import("../../identity-token/index.ts")
const { handleCheckoutInitiate } = await import("../../checkout-initiate/index.ts")

const BASE = "https://example.supabase.co/functions/v1"
const handlers: Array<[string, (r: Request) => Promise<Response>, string]> = [
  ["config", handleConfigRequest, `${BASE}/config?apiKey=pk_test_x`],
  ["identity-token", handleIdentityTokenRequest, `${BASE}/identity-token/verify`],
  ["checkout-initiate", handleCheckoutInitiate, `${BASE}/checkout-initiate?apiKey=pk_test_x`],
]

for (const [name, handle, url] of handlers) {
  Deno.test(`${name}: OPTIONS preflight → 204 allowing apikey + x-paycraft-mode`, async () => {
    const r = await handle(new Request(url, {
      method: "OPTIONS",
      headers: { origin: "https://reelsdownloader.in", "access-control-request-method": "POST" },
    }))
    assertEquals(r.status, 204)
    assertEquals(r.headers.get("access-control-allow-origin"), "*")
    const allowed = r.headers.get("access-control-allow-headers") ?? ""
    assertEquals(allowed.includes("apikey") && allowed.includes("x-paycraft-mode"), true)
  })
}

Deno.test("config: wrong method still carries CORS (405)", async () => {
  const r = await handleConfigRequest(new Request(`${BASE}/config?apiKey=pk_test_x`, { method: "PUT" }))
  assertEquals(r.status, 405)
  assertEquals(r.headers.get("access-control-allow-origin"), "*")
  await r.body?.cancel()
})

Deno.test("identity-token: unknown path still carries CORS (404)", async () => {
  const r = await handleIdentityTokenRequest(new Request(`${BASE}/identity-token/nope`, { method: "POST", body: "{}" }))
  assertEquals(r.status, 404)
  assertEquals(r.headers.get("access-control-allow-origin"), "*")
  await r.body?.cancel()
})

Deno.test("checkout-initiate: validation error still carries CORS (400)", async () => {
  const r = await handleCheckoutInitiate(new Request(`${BASE}/checkout-initiate`, { method: "POST", body: "{}" }))
  assertEquals(r.status, 400)
  assertEquals(r.headers.get("access-control-allow-origin"), "*")
  await r.body?.cancel()
})
