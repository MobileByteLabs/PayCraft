/**
 * dashboard/tests/exit-survey-editor.spec.ts — Paywall ▸ Exit survey (paycraft-paywall-analytics T15 / AC-11).
 * The tenant edits the survey; the save goes through tenant_exit_survey_save (migration 183) and the very next
 * /config — what every app and the website read — serves the edited survey.
 */

import { execSync } from "child_process"
import { expect, test } from "./authed"

const TENANT = "00000000-cafe-cafe-cafe-000000000001"
const COUPON = "00000000-cafe-cafe-cafe-00000000c0de"
const FUNCTIONS = "http://127.0.0.1:54321/functions/v1"

function psql(sql: string): string {
  return execSync(`docker exec -i supabase_db_PayCraft psql -U postgres -d postgres -v ON_ERROR_STOP=1 -qtA`, { input: sql }).toString().trim()
}

test.beforeAll(() => {
  psql(`DELETE FROM tenant_coupons WHERE id = '${COUPON}';
        INSERT INTO tenant_coupons (id, tenant_id, code, percent_off, duration, stripe_coupon_id)
        VALUES ('${COUPON}', '${TENANT}', 'E2EWINBACK50', 50, 'once', 'co_e2e');
        UPDATE tenant_exit_survey SET enabled = true, title = DEFAULT, reasons = DEFAULT, survey_cap_days = 7, offer_hours = 48
        WHERE tenant_id = '${TENANT}';`)
})

test.afterAll(() => {
  psql(`UPDATE tenant_exit_survey SET enabled = true, title = DEFAULT, reasons = DEFAULT, survey_cap_days = 7, offer_hours = 48
        WHERE tenant_id = '${TENANT}';
        DELETE FROM tenant_coupons WHERE id = '${COUPON}';`)
})

test("the tenant edits the exit survey and apps get it with their next /config", async ({ page, request }) => {
  await page.setViewportSize({ width: 1440, height: 1200 })
  await page.goto("/paywall/exit-survey")
  const editor = page.getByTestId("exit-survey-editor")
  await expect(editor).toBeVisible()
  await expect(page.locator("tr[data-testid^=reason-]")).toHaveCount(6)

  // The default "too expensive → offer" has no coupon yet: the form says so in words and will not save.
  await expect(page.getByTestId("survey-error")).toHaveText("“It's too expensive” gives an offer — pick a coupon, or switch the reason off.")
  await expect(page.getByTestId("survey-save")).toBeDisabled()

  await page.getByTestId("coupon-too_expensive").selectOption(COUPON)
  const lanes = page.getByRole("list", { name: "Where this discount applies" })
  await expect(lanes).toContainText("Stripe")
  await expect(lanes).toContainText("Razorpay · no offer")
  await expect(page.getByTestId("survey-error")).toHaveCount(0)

  await page.getByTestId("survey-title").fill("Before you go — what held you back?")
  await page.getByTestId("reason-trust").getByRole("switch").click()
  const preview = page.getByTestId("survey-preview")
  await expect(preview).toContainText("what held you back?")
  await expect(preview).not.toContainText("I don't trust it yet")
  await page.screenshot({ path: "test-results/exit-survey-editor.png", fullPage: true })

  await page.getByTestId("survey-save").click()
  await expect(page.getByTestId("survey-saved")).toContainText("live in apps within 5 min")

  const saved = JSON.parse(psql(`SELECT json_build_object('title', title, 'reasons', reasons) FROM tenant_exit_survey WHERE tenant_id = '${TENANT}'`))
  expect(saved.title).toBe("Before you go — what held you back?")
  expect(saved.reasons.find((r: { code: string }) => r.code === "too_expensive").coupon_id).toBe(COUPON)
  expect(saved.reasons.find((r: { code: string }) => r.code === "trust").enabled).toBe(false)
  expect(psql(`SELECT count(*) FROM tenant_audit_log WHERE tenant_id = '${TENANT}' AND action = 'exit_survey.update' AND ts > now() - interval '1 minute'`)).not.toBe("0")

  // What apps download: the edited question, the switched-off reason gone, the offer carrying the coupon's terms.
  const apiKey = psql(`SELECT api_key_test FROM tenants WHERE id = '${TENANT}'`)
  // `supabase functions serve` reloads its runtime whenever any function file changes (another session editing one
  // is enough), and a request landing mid-reload gets a 5xx. Retry only that, briefly; any other answer is judged.
  let res = await request.get(`${FUNCTIONS}/config?apiKey=${encodeURIComponent(apiKey)}`)
  for (let i = 0; i < 4 && res.status() >= 500; i++) {
    await page.waitForTimeout(1500)
    res = await request.get(`${FUNCTIONS}/config?apiKey=${encodeURIComponent(apiKey)}`)
  }
  expect(res.ok(), `/config ${res.status()}: ${(await res.text()).slice(0, 300)}`).toBeTruthy()
  const survey = (await res.json()).exit_survey
  expect(survey.title).toBe("Before you go — what held you back?")
  expect(survey.reasons.map((r: { code: string }) => r.code)).not.toContain("trust")
  expect(survey.reasons.find((r: { code: string }) => r.code === "too_expensive").offer.percent_off).toBe(50)
})
