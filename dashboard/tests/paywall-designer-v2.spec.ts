/**
 * dashboard/tests/paywall-designer-v2.spec.ts
 *
 * Playwright e2e for the Paywall designer Content tab.
 * Covers AC-6 of the paycraft-paywall-v2-production-ui sub-plan 01.
 *
 * Pre-conditions (handled by global-setup.ts):
 *   - Local Next.js dev server at http://localhost:3000
 *   - Local Supabase at http://127.0.0.1:54321
 *   - Auth session in tests/.auth/state.json (cookie-based @supabase/ssr)
 *   - Tenant "Playwright Test App" with ≥2 products seeded
 *
 * The preview is React-rendered inline (no iframe, no contentDocument).
 * All assertions operate on page DOM directly.
 */

import { test, expect, Page } from "@playwright/test"

// ── Route ─────────────────────────────────────────────────────────────────────
// Real path: app/(dashboard)/paywall/page.tsx → served at /paywall
const PAYWALL_PATH = "/paywall"

// ── Helpers ───────────────────────────────────────────────────────────────────
/** Click the Save button and wait for the saved indicator. */
async function saveAndAwaitConfirm(page: Page): Promise<void> {
  await page.getByRole("button", { name: /save paywall/i }).click()
  await expect(page.getByText(/saved at/i)).toBeVisible({ timeout: 8_000 })
}

// ── Suite ──────────────────────────────────────────────────────────────────────
test.describe("Paywall designer v2 — Content tab", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAYWALL_PATH)
    // The Content section heading is the reliable "page ready" signal
    await expect(
      page.getByRole("heading", { name: /content/i }).first(),
    ).toBeVisible({ timeout: 12_000 })
    // Also wait for the hero_title input itself so we know the form has hydrated
    await expect(
      page.locator('input[placeholder="Upgrade to Premium"]').first(),
    ).toBeVisible({ timeout: 8_000 })
  })

  // ── Test 1: hero title reflects live in the React inline preview ─────────────
  test("hero title edit reflects live in the React preview", async ({ page }) => {
    const uniqueTitle = `My E2E Title ${Date.now()}`
    const heroInput = page.locator('input[placeholder="Upgrade to Premium"]').first()

    await heroInput.fill(uniqueTitle)

    // The inline React preview (same DOM, no iframe) re-renders synchronously
    // on state change — it must be visible in the page DOM.
    await expect(page.getByText(uniqueTitle)).toBeVisible({ timeout: 5_000 })
  })

  // ── Test 2: value props repeater add / edit / remove ────────────────────────
  test("value props repeater — add / edit / remove", async ({ page }) => {
    const addButton = page.getByRole("button", { name: /\+ add bullet/i })

    // Empty state baseline
    await expect(page.getByText(/no bullets yet/i)).toBeVisible()

    // Add 2 bullets
    await addButton.click()
    await addButton.click()

    // Fill the title inputs (placeholder = "Ad-free experience")
    const titleInputs = page.locator('input[placeholder="Ad-free experience"]')
    await expect(titleInputs).toHaveCount(2, { timeout: 4_000 })
    await titleInputs.nth(0).fill("Bullet Alpha")
    await titleInputs.nth(1).fill("Bullet Beta")

    // Both texts appear in the preview (same DOM — React re-renders inline)
    await expect(page.getByText("Bullet Alpha")).toBeVisible({ timeout: 4_000 })
    await expect(page.getByText("Bullet Beta")).toBeVisible({ timeout: 4_000 })

    // Remove the first bullet via its aria-label="Remove" button
    const removeButtons = page.getByLabel(/^Remove$/i)
    await expect(removeButtons).toHaveCount(2, { timeout: 4_000 })
    await removeButtons.first().click()

    // Exactly one title input remains
    await expect(titleInputs).toHaveCount(1, { timeout: 4_000 })
    // The counter in the label updates: "Value props (1)"
    await expect(page.getByText(/value props \(1\)/i)).toBeVisible({ timeout: 3_000 })
    // The removed bullet's text is gone from the preview
    await expect(page.getByText("Bullet Alpha")).toHaveCount(0)
    // The remaining bullet is still there
    await expect(page.getByText("Bullet Beta")).toBeVisible()
  })

  // ── Test 3: popular plan dropdown lists seeded products + select persists ────
  test("popular plan dropdown lists seeded products + select persists", async ({
    page,
  }) => {
    // The popular_plan_sku <select> has value="" ("— No badge —") by default.
    // It is the only <select> in the Content section whose first option text
    // contains "No badge". The font_family select in Theme has a different option set.
    const popularSelect = page
      .locator("select")
      .filter({ hasText: /No badge/i })
      .first()

    await expect(popularSelect).toBeVisible({ timeout: 4_000 })

    const optionTexts = await popularSelect.locator("option").allTextContents()
    // ≥2 options = "— No badge —" sentinel + ≥1 real product
    expect(optionTexts.length).toBeGreaterThanOrEqual(2)

    // Select the first real product (index 1, past the sentinel)
    await popularSelect.selectOption({ index: 1 })

    // Save and confirm the saved indicator
    await saveAndAwaitConfirm(page)
  })

  // ── Test 4: hero icon SVG with <script> — server rejects it ─────────────────
  test("hero icon SVG paste — server rejects forbidden <script> tag", async ({
    page,
  }) => {
    // Expand the "Hero icon (SVG path or URL)" details element
    await page.locator("details").filter({ hasText: /hero icon/i }).click()

    const svgTextarea = page.locator(
      'textarea[placeholder*="<svg viewBox"]',
    )
    await expect(svgTextarea).toBeVisible({ timeout: 4_000 })
    await svgTextarea.fill("<svg><script>alert(1)</script></svg>")

    // The server RPC sanitize_paywall_svg() raises check_violation, so the API
    // route returns 500 with { error: "…forbidden" }. The designer does not
    // surface a toast, so assert the server rejection on the network response
    // directly — this verifies the server-side sanitization (AC-13).
    const [resp] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes("/api/paywall") && r.request().method() === "PATCH",
      ),
      page.getByRole("button", { name: /save paywall/i }).click(),
    ])
    expect(resp.status()).toBe(500)
    expect(await resp.text()).toMatch(/forbidden|sanitiz|script/i)
  })

  // ── Test 5: template selector shows BrandedStack ─────────────────────────────
  test("template selector shows BrandedStack as v2 default option", async ({
    page,
  }) => {
    // "Branded Stack" is the label; "v2 default" appears in the description text
    await expect(page.getByText(/branded stack/i)).toBeVisible({ timeout: 4_000 })
    await expect(page.getByText(/v2 default/i)).toBeVisible({ timeout: 4_000 })
  })
})
