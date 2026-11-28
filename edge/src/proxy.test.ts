// deno test edge/src/proxy.test.ts
import { assertEquals } from "jsr:@std/assert@1"
import { UPSTREAM, isForwarded, upstreamRequest } from "./proxy.ts"

Deno.test("forwards the Supabase client APIs only", () => {
  for (const p of ["/rest/v1/rpc/x", "/functions/v1/config", "/auth/v1/token", "/storage/v1/object/a", "/realtime/v1/websocket"]) {
    assertEquals(isForwarded(p), true, p)
  }
  for (const p of ["/", "/pg/query", "/rest/v2/x", "/functions/v1", "/studio"]) assertEquals(isForwarded(p), false, p)
})

Deno.test("aims at Supabase, keeps method, query, headers and body", async () => {
  const req = new Request("https://edge.paycraft.mobilebytesensei.com/functions/v1/config?apiKey=pk_1", {
    method: "POST",
    headers: { apikey: "anon", authorization: "Bearer t", "content-type": "application/json" },
    body: '{"a":1}',
  })
  const out = upstreamRequest(req, "203.0.113.7")
  assertEquals(out.url, `${UPSTREAM}/functions/v1/config?apiKey=pk_1`)
  assertEquals(out.method, "POST")
  assertEquals(out.headers.get("apikey"), "anon")
  assertEquals(out.headers.get("authorization"), "Bearer t")
  assertEquals(await out.text(), '{"a":1}')
})

// A client-supplied X-Forwarded-For must not survive — it would let a caller choose the IP rate limits key on.
Deno.test("replaces X-Forwarded-For with the address Cloudflare saw", () => {
  const req = new Request("https://edge.paycraft.mobilebytesensei.com/rest/v1/x", { headers: { "x-forwarded-for": "1.2.3.4" } })
  assertEquals(upstreamRequest(req, "203.0.113.7").headers.get("x-forwarded-for"), "203.0.113.7")
  assertEquals(upstreamRequest(req, null).headers.get("x-forwarded-for"), null)
})

// The country the functions record comes from Cloudflare only (realtime-analytics design, "Country").
Deno.test("x-paycraft-country is Cloudflare's country, never the client's", () => {
  const spoofed = new Request("https://edge.paycraft.mobilebytesensei.com/functions/v1/events", {
    method: "POST",
    headers: { "x-paycraft-country": "US" },
    body: "{}",
  })
  assertEquals(upstreamRequest(spoofed, null, "in").headers.get("x-paycraft-country"), "IN")
  assertEquals(upstreamRequest(spoofed, null, null).headers.get("x-paycraft-country"), null)
  assertEquals(upstreamRequest(spoofed, null).headers.get("x-paycraft-country"), null)
  for (const bad of ["T1", "XYZ", "", " "]) {
    assertEquals(upstreamRequest(spoofed, null, bad).headers.get("x-paycraft-country"), null, bad)
  }
})

Deno.test("cf country is forwarded when the client sent none", () => {
  const req = new Request("https://edge.paycraft.mobilebytesensei.com/rest/v1/x")
  assertEquals(upstreamRequest(req, "203.0.113.7", "DE").headers.get("x-paycraft-country"), "DE")
})
