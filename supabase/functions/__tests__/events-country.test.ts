// The country an event is stored with, and where it came from (paycraft-ga4-analytics-audit D6 / AC-2).
// Supabase's edge sends no geo header, so every live paywall_events row had country = null (2026-11-25). The server's
// geo still wins; the device's region (sent per event as `deviceCountry`) is the fallback, labelled 'device'.
// Run: deno test -A supabase/functions/__tests__/events-country.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { eventCountry, geoCountry } from "../_shared/geo.ts"

const req = (headers: Record<string, string> = {}) => new Request("https://x/functions/v1/events", { headers })

Deno.test("the edge's geo wins and is labelled server", () => {
  assertEquals(eventCountry(req({ "cf-ipcountry": "IN" }), "ID"), { country: "IN", source: "server" })
})

Deno.test("no edge geo: the device's region, labelled device", () => {
  assertEquals(eventCountry(req(), "id"), { country: "ID", source: "device" })
  assertEquals(eventCountry(req(), "IDN"), { country: "ID", source: "device" })
})

Deno.test("Accept-Language region is the device fallback when the event carries none", () => {
  assertEquals(eventCountry(req({ "accept-language": "pt-BR,pt;q=0.9" }), null), { country: "BR", source: "device" })
})

Deno.test("nothing usable → null, never a guess", () => {
  assertEquals(eventCountry(req(), null), { country: null, source: null })
  assertEquals(eventCountry(req(), "XX"), { country: null, source: null })
  assertEquals(eventCountry(req(), "not-a-country"), { country: null, source: null })
})

// The paycraft-edge Worker's country (from request.cf.country) wins over every other header (migration 223 / design
// "Country"), then the existing headers.
Deno.test("x-paycraft-country wins over cf-ipcountry and is uppercased", () => {
  assertEquals(eventCountry(req({ "x-paycraft-country": "de", "cf-ipcountry": "JP" }), "ID"), { country: "DE", source: "server" })
  assertEquals(geoCountry(req({ "x-paycraft-country": " in " })), "IN")
})

Deno.test("an invalid x-paycraft-country falls through to the existing headers", () => {
  for (const bad of ["XX", "DEU", "1A", ""]) {
    assertEquals(geoCountry(req({ "x-paycraft-country": bad, "cf-ipcountry": "JP" })), "JP", bad)
  }
  assertEquals(eventCountry(req({ "x-paycraft-country": "XX" }), "id"), { country: "ID", source: "device" })
})
