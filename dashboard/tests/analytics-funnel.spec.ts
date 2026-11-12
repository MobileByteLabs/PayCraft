/**
 * dashboard/tests/analytics-funnel.spec.ts — the paywall funnel renders from real `paywall_events`
 * (paycraft-paywall-analytics T7 / AC-6). Seeds a small funnel for the e2e tenant straight into the local
 * database, opens /analytics signed in, and checks the numbers on screen are the seeded ones.
 */

import { execSync } from "child_process"
import { expect, test } from "./authed"

const TENANT = "00000000-cafe-cafe-cafe-000000000001"

function psql(sql: string) {
  execSync(`docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q`, { input: sql })
}

test.beforeAll(() => {
  const rows: string[] = []
  const add = (name: string, device: string, country: string | null, provider: string | null) =>
    rows.push(`('${TENANT}', '${device}', '${name}', 'paywall', 'android', ${country ? `'${country}'` : "NULL"}, ${provider ? `'${provider}'` : "NULL"}, 'live', now() - interval '1 hour')`)
  // 5 viewers (IN ×3, US ×2) → 4 pick a plan → 2 start checkout → 1 pays
  for (const [d, c] of [["v1", "IN"], ["v2", "IN"], ["v3", "IN"], ["v4", "US"], ["v5", "US"]] as const) add("paycraft_paywall_view", d, c, null)
  for (const d of ["v1", "v2", "v3", "v4"]) add("paycraft_plan_select", d, null, null)
  add("paycraft_checkout_start", "v1", "IN", "razorpay")
  add("paycraft_checkout_start", "v4", "US", "stripe")
  add("paycraft_purchase_success", "v1", "IN", "razorpay")
  psql(`DELETE FROM paywall_events WHERE tenant_id = '${TENANT}';
        INSERT INTO paywall_events (tenant_id, device_ref, name, step, platform, country, provider, mode, occurred_at)
        VALUES ${rows.join(",\n")};`)
})

test.afterAll(() => psql(`DELETE FROM paywall_events WHERE tenant_id = '${TENANT}';`))

test("the paywall funnel shows the seeded buyers per stage, country and provider", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1100 })
  await page.goto("/analytics?range=7")
  const funnel = page.getByRole("list", { name: "Paywall funnel" })
  await expect(funnel).toBeVisible()
  await expect(funnel.getByText("Viewed paywall")).toBeVisible()
  const counts = await funnel.locator("li span.font-bold").allTextContents()
  expect(counts).toEqual(["5", "4", "2", "1"])
  await expect(funnel).toContainText("20.0% overall")
  await expect(page.getByRole("heading", { name: "By country" })).toBeVisible()
  await expect(page.getByText("India (IN)")).toBeVisible()
  await expect(page.getByText("Razorpay")).toBeVisible()
  await expect(page.getByText("Not chosen")).toHaveCount(0) // views carry no provider; the provider table starts at checkout
  await page.getByText("Last 7 days").first().click()
  await expect(page.getByRole("link", { name: "Last 7 days" })).toBeVisible()
  await page.screenshot({ path: "test-results/analytics-funnel.png", fullPage: false })
})
