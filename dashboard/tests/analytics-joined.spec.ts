/**
 * dashboard/tests/analytics-joined.spec.ts — the joined Analytics view (paycraft-ga4-analytics-audit AC-6).
 *
 * One filter set narrows GA4 AND PayCraft's provider-truth funnel: the page is opened unfiltered, then filtered to
 * Indonesia + Android through the filter form, and both columns must change while the URL carries the filters.
 * GA4 is the stand-in on 127.0.0.1:54399 (same as ga4-connect.spec.ts); it answers per dimension and records every
 * request body, so the test also proves each GA4 report carried the tenant's stream filter and the country filter.
 */

import { execSync } from "child_process"
import { createServer, type Server } from "http"
import { expect, test } from "./authed"

const TENANT = "00000000-cafe-cafe-cafe-000000000001"
const PROPERTY = "123456789"
const STREAM = "10231617924"

function psql(sql: string) {
  execSync(`docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q`, { input: sql })
}

let server: Server
const bodies: string[] = []

const cleanup = `DELETE FROM paywall_events WHERE tenant_id = '${TENANT}';
  DELETE FROM tenant_ga4_connections WHERE tenant_id = '${TENANT}';`

test.beforeAll(async () => {
  // PayCraft events: 3 android viewers in ID, 2 ios viewers in IN; one ID android buyer checks out.
  const rows: string[] = []
  const add = (name: string, device: string, platform: string, country: string, version: string) =>
    rows.push(`('${TENANT}', '${device}', '${name}', 'paywall', '${platform}', '${country}', 'device', '${version}', 'live', now() - interval '1 hour')`)
  for (const d of ["a1", "a2", "a3"]) add("paycraft_paywall_view", d, "android", "ID", "2.4.1")
  for (const d of ["i1", "i2"]) add("paycraft_paywall_view", d, "ios", "IN", "2.4.0")
  add("paycraft_checkout_start", "a1", "android", "ID", "2.4.1")
  psql(`${cleanup}
    INSERT INTO paywall_events (tenant_id, device_ref, name, step, platform, country, country_source, app_version, mode, occurred_at)
    VALUES ${rows.join(",\n")};
    INSERT INTO tenant_ga4_connections (tenant_id, property_id, verified_at, stream_ids)
    VALUES ('${TENANT}', '${PROPERTY}', now(), ARRAY['${STREAM}']);`)

  server = createServer((req, res) => {
    let raw = ""
    req.on("data", (c) => (raw += c))
    req.on("end", () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" })
        res.end(JSON.stringify(body))
      }
      if (req.url === "/token") return send(200, { access_token: "e2e-token", expires_in: 3600, token_type: "Bearer" })
      if (!req.url?.match(/^\/v1beta\/properties\/\d+:runReport$/)) return send(404, {})
      bodies.push(raw)
      const body = JSON.parse(raw)
      const filtered = raw.includes('"countryId"')
      const dims = (body.dimensions ?? []).map((d: { name: string }) => d.name).join(",")
      const row = (d: string[], m: number[]) => ({ dimensionValues: d.map((value) => ({ value })), metricValues: m.map((v) => ({ value: String(v) })) })
      if (dims === "eventName") {
        // Unfiltered: 5,000 viewers. Filtered to ID/android: 1,300.
        return send(200, { rows: filtered
          ? [row(["paycraft_paywall_view"], [1300, 2000]), row(["paycraft_checkout_start"], [90, 120])]
          : [row(["paycraft_paywall_view"], [5000, 9000]), row(["paycraft_checkout_start"], [300, 410])] })
      }
      if (dims === "platform,eventName") return send(200, { rows: [row(["Android", "paycraft_paywall_view"], [filtered ? 1300 : 4600, 0])] })
      if (dims === "countryId,eventName") return send(200, { rows: [row(["ID", "paycraft_paywall_view"], [1300, 0])] })
      if (dims === "appVersion,eventName") return send(200, { rows: [row(["2.4.1", "paycraft_paywall_view"], [1200, 0])] })
      if (dims === "date") return send(200, { rows: [row(["20261124"], [900])] })
      if (dims === "") return send(200, { rows: [row([], [4812, 9930])] })
      return send(200, { rows: [] })
    })
  })
  await new Promise<void>((r) => server.listen(54399, "127.0.0.1", r))
})

test.afterAll(async () => {
  psql(cleanup)
  await new Promise<void>((r) => server.close(() => r()))
})

test("one filter set narrows GA4 and the provider-truth funnel together", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1200 })
  await page.goto("/analytics?range=7")
  const ga4 = page.getByRole("list", { name: "GA4 funnel" })
  await expect(ga4).toContainText("5,000")
  const paycraft = page.getByRole("list", { name: "Paywall funnel" })
  await expect(paycraft.locator("li span.font-bold").first()).toHaveText("5")

  const form = page.getByRole("form", { name: "Analytics filters" })
  await form.getByLabel("Country").selectOption("ID")
  await form.getByLabel("Platform").selectOption("android")
  await form.getByRole("button", { name: "Apply" }).click()

  await expect(page).toHaveURL(/country=ID/)
  await expect(page).toHaveURL(/platform=android/)
  await expect(ga4).toContainText("1,300")
  await expect(paycraft.locator("li span.font-bold").first()).toHaveText("3")
  await expect(page.getByRole("table", { name: "By country" })).toContainText("Indonesia (ID)")
  await expect(page.getByRole("heading", { name: "AI audit" })).toBeVisible()

  // Every GA4 report was limited to the tenant's own stream; the filtered ones also to the country.
  expect(bodies.length).toBeGreaterThan(0)
  expect(bodies.every((b) => b.includes(`"streamId","inListFilter":{"values":["${STREAM}"]}`))).toBe(true)
  expect(bodies.some((b) => b.includes('"fieldName":"countryId","stringFilter":{"matchType":"EXACT","value":"ID"}'))).toBe(true)

  await page.screenshot({ path: "test-results/analytics-joined.png", fullPage: true })
})
