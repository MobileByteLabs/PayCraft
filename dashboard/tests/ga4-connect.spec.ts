/**
 * dashboard/tests/ga4-connect.spec.ts — Analytics ▸ Google Analytics (paycraft-paywall-analytics T16 / AC-12).
 *
 * Google's token endpoint and GA4 Data API are stood in for on 127.0.0.1:54399 (playwright.config points an
 * ephemeral service account's token_uri and PAYCRAFT_GA4_API_BASE there), so the whole path runs for real in the
 * dashboard: the signed JWT assertion asks for the read-only Analytics scope, a property PayCraft is not a Viewer
 * on gives the "add this email" fix, a readable one connects and shows its numbers, and withheld rows say so.
 */

import { execSync } from "child_process"
import { createServer, type Server } from "http"
import { expect, test } from "./authed"

const TENANT = "00000000-cafe-cafe-cafe-000000000001"
const SA_EMAIL = "paycraft-ga4@paycraft-e2e.iam.gserviceaccount.com"
const NO_ACCESS = "999999999"
const READABLE = "123456789"

function psql(sql: string) {
  execSync(`docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q`, { input: sql })
}

let server: Server
const scopes: string[] = []
const reports: { property: string; auth: string | undefined }[] = []

test.beforeAll(async () => {
  psql(`DELETE FROM tenant_ga4_connections WHERE tenant_id = '${TENANT}';`)
  server = createServer((req, res) => {
    let raw = ""
    req.on("data", (c) => (raw += c))
    req.on("end", () => {
      const send = (status: number, body: unknown) => {
        res.writeHead(status, { "content-type": "application/json" })
        res.end(JSON.stringify(body))
      }
      if (req.url === "/token") {
        const assertion = new URLSearchParams(raw).get("assertion") ?? ""
        scopes.push(JSON.parse(Buffer.from(assertion.split(".")[1] ?? "", "base64url").toString()).scope)
        return send(200, { access_token: "e2e-token", expires_in: 3600, token_type: "Bearer" })
      }
      const m = req.url?.match(/^\/v1beta\/properties\/(\d+):runReport$/)
      if (!m) return send(404, {})
      reports.push({ property: m[1], auth: req.headers.authorization })
      if (m[1] === NO_ACCESS) return send(403, { error: { code: 403, status: "PERMISSION_DENIED" } })
      const body = JSON.parse(raw)
      const dims = (body.dimensions ?? []).map((d: { name: string }) => d.name).join(",")
      if (dims === "") return send(200, { rows: [{ metricValues: [{ value: "4812" }, { value: "9930" }] }] })
      if (dims === "date") {
        return send(200, {
          rows: [["20261104", 520], ["20261105", 610], ["20261106", 580], ["20261107", 700], ["20261108", 650], ["20261109", 760], ["20261110", 802]]
            .map(([d, v]) => ({ dimensionValues: [{ value: d }], metricValues: [{ value: String(v) }] })),
        })
      }
      return send(200, {
        rows: [
          ["paycraft_paywall_view", "India", 1000], ["paycraft_paywall_view", "United States", 240],
          ["paycraft_checkout_start", "India", 180], ["paycraft_purchase_success", "India", 42], ["paycraft_paywall_view", "(other)", 12],
        ].map(([e, c, v]) => ({ dimensionValues: [{ value: e }, { value: c }], metricValues: [{ value: String(v) }] })),
        metadata: { subjectToThresholding: true },
      })
    })
  })
  await new Promise<void>((r) => server.listen(54399, "127.0.0.1", r))
})

test.afterAll(async () => {
  psql(`DELETE FROM tenant_ga4_connections WHERE tenant_id = '${TENANT}';`)
  await new Promise<void>((r) => server.close(() => r()))
})

test("a tenant connects GA4 with PayCraft's Viewer account and sees its numbers", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1400 })
  await page.goto("/analytics?range=7")
  const card = page.getByTestId("ga4-connect")
  await expect(card).toBeVisible()
  await expect(page.getByTestId("ga4-sa-email")).toHaveText(SA_EMAIL)

  // PayCraft is not a Viewer on this property yet: the page says exactly what to do.
  await page.getByTestId("ga4-property").fill(NO_ACCESS)
  await page.getByRole("button", { name: "Connect" }).click()
  await expect(page.getByTestId("ga4-error")).toContainText(`add ${SA_EMAIL} as a Viewer`)

  await page.getByTestId("ga4-property").fill(READABLE)
  await page.getByRole("button", { name: "Connect" }).click()
  await expect(page.getByTestId("ga4-connected")).toContainText(`Connected to property ${READABLE}`)
  const panels = page.getByTestId("ga4-panels")
  await expect(panels).toContainText("4,812")
  await expect(panels).toContainText("9,930")
  await expect(panels).toContainText("1,252") // paywall views: 1,000 + 240 + 12 withheld-country
  await expect(panels.getByRole("img", { name: /Active users per day/ })).toBeVisible()
  await expect(panels.getByRole("table", { name: "PayCraft events by country" })).toContainText("withheld by Google")
  await expect(panels.getByTestId("ga4-withheld")).toBeVisible()
  await page.locator("#ga4-h").scrollIntoViewIfNeeded()
  await page.screenshot({ path: "test-results/ga4-connected.png", fullPage: false })

  expect(scopes.every((s) => s === "https://www.googleapis.com/auth/analytics.readonly")).toBe(true)
  expect(reports.every((r) => r.auth === "Bearer e2e-token")).toBe(true)

  await page.getByRole("button", { name: "Disconnect" }).click()
  await expect(page.getByTestId("ga4-connect")).toBeVisible()
})
