// GA4 for the weekly digest (paycraft-ga4-analytics-audit sub-plan 04): the tenant's OWN streams only (a property can
// hold other apps), read with PayCraft's org service account (PAYCRAFT_GA4_SA_JSON), aggregated to typed lines the
// prompt can carry — counts and ISO codes, never a user.
// Run: deno test -A supabase/functions/__tests__/ga4-report.test.ts
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { exportPKCS8, generateKeyPair } from "https://deno.land/x/jose@v5.9.6/index.ts"
import { ga4WeekForTenant } from "../_shared/ga4-report.ts"

async function saJson() {
  const { privateKey } = await generateKeyPair("RS256", { extractable: true })
  return JSON.stringify({ client_email: "sa@x.iam.gserviceaccount.com", private_key: await exportPKCS8(privateKey), token_uri: "https://token.test/token" })
}

const row = (d: string[], m: number[]) => ({ dimensionValues: d.map((value) => ({ value })), metricValues: m.map((v) => ({ value: String(v) })) })

function fakeFetch(bodies: string[], scopes: string[]) {
  return (async (url: string | URL, init?: RequestInit) => {
    const u = String(url)
    if (u === "https://token.test/token") {
      const assertion = new URLSearchParams(String(init?.body)).get("assertion") ?? ""
      scopes.push(JSON.parse(atob(assertion.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).scope)
      return new Response(JSON.stringify({ access_token: "t" }))
    }
    bodies.push(String(init?.body))
    const dims = (JSON.parse(String(init?.body)).dimensions ?? []).map((d: { name: string }) => d.name).join(",")
    if (dims === "eventName") return new Response(JSON.stringify({ rows: [row(["paycraft_paywall_view"], [1088, 3755]), row(["paycraft_checkout_start"], [108, 245])] }))
    if (dims === "countryId,eventName") return new Response(JSON.stringify({ rows: [row(["ID", "paycraft_paywall_view"], [133, 264]), row(["(not set)", "paycraft_paywall_view"], [4, 4])] }))
    return new Response(JSON.stringify({ rows: [] }))
  }) as typeof fetch
}

Deno.test("reads the tenant's own streams with the read-only Analytics scope", async () => {
  const bodies: string[] = []
  const scopes: string[] = []
  await ga4WeekForTenant({ property_id: "473327398", stream_ids: ["10231617924"] }, "2026-11-17", "2026-11-23", await saJson(), fakeFetch(bodies, scopes))
  assert(bodies.length >= 4)
  for (const b of bodies) assert(b.includes('"streamId","inListFilter":{"values":["10231617924"]}'), b)
  assertEquals([...new Set(scopes)], ["https://www.googleapis.com/auth/analytics.readonly"])
})

Deno.test("returns typed aggregate lines: funnel users and top segments, GA4 placeholders as unknown", async () => {
  const res = await ga4WeekForTenant({ property_id: "p", stream_ids: [] }, "2026-11-17", "2026-11-23", await saJson(), fakeFetch([], []))
  assert(res)
  assertEquals(res.funnel.paycraft_paywall_view, 1088)
  assertEquals(res.funnel.paycraft_checkout_start, 108)
  assertEquals(res.byCountry.map((r) => r.key), ["ID", "unknown"])
})

Deno.test("no service account or no connection → null, the digest goes on without GA4", async () => {
  assertEquals(await ga4WeekForTenant(null, "2026-11-17", "2026-11-23", await saJson(), fakeFetch([], [])), null)
  assertEquals(await ga4WeekForTenant({ property_id: "p", stream_ids: [] }, "2026-11-17", "2026-11-23", "", fakeFetch([], [])), null)
})

Deno.test("a GA4 error is null, never a throw that stops the tenant's digest", async () => {
  const failing = (async (url: string | URL) =>
    String(url).includes("token") ? new Response(JSON.stringify({ access_token: "t" })) : new Response("", { status: 403 })) as typeof fetch
  assertEquals(await ga4WeekForTenant({ property_id: "p", stream_ids: [] }, "2026-11-17", "2026-11-23", await saJson(), failing), null)
})
