/**
 * dashboard/tests/attempt-observability.spec.ts — the four owner surfaces of paycraft-attempt-observability
 * (05-dashboard T9 / AC-16), rendered signed-in against the local database:
 *   · subscriber detail → the buyer's attempt timeline, the failed step labelled by stage
 *   · Analytics → the Payment health panel beside the (unchanged) funnel, with the seed's hand-computed numbers
 *   · Alerts → the inbox and the sidebar's unread pill, which drops when an alert is marked read
 *   · Settings → Alert channels persisted encrypted, never echoed back, and a real "Send test"
 *
 * The seed (tests/fixtures/attempt-observability-seed.sql) goes into the real tables; afterAll removes it.
 *
 * Alert channel URLs and secrets are pgcrypto-encrypted, and encrypt_provider_key refuses the local dev-default
 * passphrase, so beforeAll swaps in a throwaway one and afterAll puts the original back — the same approach as
 * supabase/tests/191 and 211. The original is held in this process's memory, never printed, and NO DDL runs here:
 * any CREATE / DROP makes PostgREST reload its schema cache and recycle its pool, and a request landing in that
 * window gets no membership back and is redirected to /onboarding (observed: it failed this very suite).
 */

import { execSync } from "child_process"
import { readFileSync, statSync } from "fs"
import path from "path"
import { expect, test } from "./authed"

const TENANT = "00000000-cafe-cafe-cafe-000000000001"
const CAROL_SUB = "00000000-0e2e-0e2e-0e2e-00000000ca01"
const SEED = path.join(__dirname, "fixtures", "attempt-observability-seed.sql")
const SLACK_URL = "https://hooks.slack.com/services/T0E2E/B0E2E/e2eplaywrightonly"
// .invalid never resolves (RFC 2606), so the webhook test fails without reaching anyone.
const WEBHOOK_URL = "https://alerts.e2e.invalid/paycraft"
const SHOTS = ["attempt-timeline.png", "payment-health.png", "alerts-inbox.png", "alert-channels.png"].map((f) => path.join("test-results", f))

function psql(sql: string): string {
  return execSync(`docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 -q -At`, { input: sql }).toString()
}

/** The passphrase that was configured before this suite ran — restored in afterAll, never logged. */
let originalPassphrase: string | null = null
const dollarQuoted = (v: string) => `$e2e_pp$${v}$e2e_pp$`

const CLEANUP = `
  DELETE FROM alert_deliveries WHERE alert_id IN (SELECT id FROM tenant_alerts WHERE tenant_id = '${TENANT}');
  DELETE FROM tenant_alerts         WHERE tenant_id = '${TENANT}';
  DELETE FROM tenant_alert_channels WHERE tenant_id = '${TENANT}';
  DELETE FROM tenant_alert_prefs    WHERE tenant_id = '${TENANT}';
  DELETE FROM attempt_events        WHERE tenant_id = '${TENANT}';
  DELETE FROM checkout_attempts     WHERE tenant_id = '${TENANT}';
  DELETE FROM paywall_events        WHERE tenant_id = '${TENANT}';
  DELETE FROM subscriptions         WHERE tenant_id = '${TENANT}';`

test.describe.configure({ mode: "serial" })

test.beforeAll(() => {
  originalPassphrase = psql("SELECT passphrase FROM public.paycraft_secrets_config WHERE id = TRUE;").replace(/\n$/, "")
  psql(`${CLEANUP}
    UPDATE public.paycraft_secrets_config SET passphrase = 'e2e-alert-channels-' || gen_random_uuid()::text WHERE id = TRUE;`)
  psql(readFileSync(SEED, "utf-8").replace(/__TENANT__/g, TENANT))
})

test.afterAll(() => {
  psql(CLEANUP)
  if (originalPassphrase !== null) {
    psql(`UPDATE public.paycraft_secrets_config SET passphrase = ${dollarQuoted(originalPassphrase)} WHERE id = TRUE;`)
  }
})

test("subscriber detail renders the attempt timeline with the failed step labelled by stage", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1300 })
  await page.goto(`/subscribers/${CAROL_SUB}`)
  const list = page.getByRole("list", { name: "Payment attempts" })
  await expect(list).toBeVisible()
  const cards = list.locator(":scope > li")
  await expect(cards).toHaveCount(3)
  // Newest first: abandoned (6 h ago) → failed (1 day) → granted (3 days).
  await expect(cards.nth(0)).toHaveAttribute("data-state", "abandoned")
  await expect(cards.nth(1)).toHaveAttribute("data-state", "failed")
  await expect(cards.nth(2)).toHaveAttribute("data-state", "granted")

  const failed = cards.nth(1)
  await expect(failed.getByText("Failed", { exact: true }).first()).toBeVisible()
  const failingStep = failed.locator("[data-failing]")
  await expect(failingStep).toHaveCount(1)
  await expect(failingStep).toContainText(/Provider.·.card_declined/)
  await expect(failingStep).toContainText("Your card was declined.")
  await expect(failed.getByText("exact")).toBeVisible()
  await expect(cards.nth(2).getByText("Access granted")).toBeVisible()
  await expect(cards.nth(0).getByText("Abandoned", { exact: true }).first()).toBeVisible()
  await expect(page.getByText("3 attempts")).toBeVisible()

  await page.getByRole("heading", { name: "Payment attempts" }).scrollIntoViewIfNeeded()
  await page.locator("section[aria-labelledby=attempts-h]").screenshot({ path: SHOTS[0] })
})

test("analytics shows the Payment health panel beside the funnel, with the seed's numbers", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1400 })
  await page.goto("/analytics?range=7")
  await expect(page.getByRole("list", { name: "Paywall funnel" })).toBeVisible() // the funnel is untouched
  const health = page.getByRole("region", { name: "Payment health" })
  await expect(health).toBeVisible()
  await expect(health.getByText("1 paid, not granted")).toBeVisible()

  const byStage = health.getByRole("table", { name: "Failure rate by stage" })
  await expect(byStage.locator("tbody tr")).toHaveCount(2)
  await expect(byStage).toContainText("Provider")
  await expect(byStage).toContainText("Entitlement")
  await expect(byStage.locator("[data-hot]")).toHaveText(["20.0%", "20.0%"]) // 1 of 5 each, ≥ 10% → red

  const byProvider = health.getByRole("table", { name: "Failure rate by provider" })
  await expect(byProvider.locator("tbody tr").first()).toContainText("Stripe")
  await expect(byProvider.locator("tbody tr").first()).toContainText("66.7%")

  const byCountry = health.getByRole("table", { name: "Failure rate by country" })
  await expect(byCountry).toContainText("India (IN)")
  await expect(byCountry.locator("tbody tr", { hasText: "United States" })).toContainText("100.0%")

  const steps = health.getByRole("list", { name: "Abandon rate by step" })
  await expect(steps.locator("li")).toHaveCount(3)
  await expect(steps.locator("li").nth(0)).toContainText("1 / 5")
  await expect(steps.locator("li").nth(1)).toContainText("1 / 4")
  await expect(steps.locator("li").nth(1)).toContainText("25.0%")
  await expect(health.getByTestId("nudge-reach")).toContainText("50.0%")

  await health.scrollIntoViewIfNeeded()
  await health.screenshot({ path: SHOTS[1] })
})

test("alerts inbox renders colour-coded rows and the sidebar unread pill drops on Mark read", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1100 })
  await page.goto("/alerts")
  const inbox = page.getByRole("list", { name: "Alerts" })
  await expect(inbox.locator(":scope > li")).toHaveCount(3)
  // Unread first, newest first: digest (60 min) → critical (100 min) → the read critical (1 day).
  const rows = inbox.locator(":scope > li")
  await expect(rows.nth(0)).toContainText("Hourly digest — 2 abandoned checkouts")
  await expect(rows.nth(1)).toContainText("Paid but not granted")
  await expect(rows.nth(1).getByText("Critical")).toBeVisible()
  await expect(rows.nth(1)).toContainText(/Entitlement · grant_timeout/)
  await expect(rows.nth(1).getByText("inferred")).toBeVisible()
  await expect(rows.nth(1).getByLabel("Deliveries")).toContainText("Slack500")
  await expect(rows.nth(2)).not.toHaveAttribute("data-unread", "true")
  await expect(page.getByRole("heading", { name: "Weekly insights" })).toBeVisible()
  await expect(page.getByText("No weekly insight yet.")).toBeVisible()

  const badge = page.locator("aside").getByTestId("alerts-unread-badge")
  await expect(badge).toHaveText("2")
  await expect(badge).toHaveAttribute("data-critical", "true")
  await page.screenshot({ path: SHOTS[2], fullPage: false })

  await rows.nth(1).getByRole("button", { name: "Mark read" }).click()
  await expect(badge).toHaveText("1")
  await expect(badge).not.toHaveAttribute("data-critical", "true") // only the digest is left → grey pill
  const stored = execSync(
    `docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -Atc "SELECT read_at IS NOT NULL FROM tenant_alerts WHERE id = '00000000-0e2e-0e2e-0e2e-0000000a1e01'"`,
  ).toString().trim()
  expect(stored).toBe("t")
})

test("alert channels persist encrypted, never come back in plaintext, and Send test delivers", async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 1800 })
  await page.goto("/settings")
  const card = page.getByTestId("alert-channels-card")
  await expect(card.getByText("What each channel receives")).toBeVisible()
  await expect(card.getByTestId("alert-channel-slack")).toContainText("Not set")

  await card.getByLabel("Slack webhook URL", { exact: true }).fill(SLACK_URL)
  await card.getByLabel("Webhook URL", { exact: true }).fill(WEBHOOK_URL)
  await card.getByRole("button", { name: "Generate" }).click()
  await card.getByRole("checkbox", { name: "Abandoned checkouts alerts" }).uncheck({ force: true })
  await card.getByRole("button", { name: "Save", exact: true }).click()
  await expect(card.getByRole("status").filter({ hasText: "Saved." })).toBeVisible()
  await expect(card.getByTestId("alert-channel-slack")).toContainText("Connected")
  await expect(card.getByTestId("alert-channel-webhook")).toContainText("Secret set")
  await expect(card.getByLabel("Slack webhook URL", { exact: true })).toHaveValue("") // the saved URL is never put back in the form

  // Nothing secret comes back from the API, and the database holds ciphertext, not the URL.
  const api = await page.request.get("/api/alert-channels")
  const text = await api.text()
  expect(api.ok()).toBe(true)
  expect(text).not.toContain("hooks.slack.com")
  expect(text).not.toContain("e2e.invalid")
  expect(text).not.toContain("whsec_")
  expect(JSON.parse(text).kinds.abandon_digest).toBe(false)
  // Byte-level search: ciphertext is random bytes, and text conversion (convert_from) fails whenever one is 0x00.
  const ciphertext = execSync(
    `docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -Atc "SELECT position(convert_to('hooks.slack.com', 'UTF8') in slack_url_enc) = 0 AND slack_url_enc IS NOT NULL FROM tenant_alert_channels WHERE tenant_id = '${TENANT}'"`,
  ).toString().trim()
  expect(ciphertext).toBe("t")

  // Inbox test → a real channel_test alert through the attempt-alerts engine; the webhook test fails (unresolvable host) and says so.
  await card.getByTestId("alert-channel-inbox").getByRole("button", { name: "Send test" }).click()
  await expect(card.getByTestId("alert-test-result-inbox")).toContainText("Delivered", { timeout: 30_000 })
  await card.getByTestId("alert-channel-webhook").getByRole("button", { name: "Send test" }).click()
  await expect(card.getByTestId("alert-test-result-webhook")).toContainText("Failed", { timeout: 30_000 })
  await expect(card.getByTestId("alert-test-result-webhook")).not.toContainText("e2e.invalid") // the write-only URL never comes back
  const tests = execSync(
    `docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -Atc "SELECT count(*) FROM tenant_alerts WHERE tenant_id = '${TENANT}' AND kind = 'channel_test'"`,
  ).toString().trim()
  expect(Number(tests)).toBe(2)

  await card.scrollIntoViewIfNeeded()
  await card.screenshot({ path: SHOTS[3] })
})

test("screenshots were written (device-truth gate)", () => {
  for (const p of SHOTS) expect(statSync(p).size).toBeGreaterThan(5_000)
})
