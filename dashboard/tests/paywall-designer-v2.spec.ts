// dashboard/tests/paywall-designer-v2.spec.ts
//
// Playwright tests for the v2 Paywall designer Content section + WYSIWYG iframe.
// Covers AC#4, AC#5, AC#6 of the paycraft-paywall-v2-production-ui sub-plan 01.
//
// Pre-conditions:
//   - dashboard dev server running at http://localhost:3000
//   - Authenticated admin session (Playwright fixture wires this via auth-state.json)
//   - Tenant with at least 1 product so the popular_plan_sku dropdown has options
//
// The visual diff baseline (paywall-preview-baseline.png) is committed alongside
// this spec. Re-baseline via `pnpm exec playwright test --update-snapshots`.

import { test, expect } from "@playwright/test"

const PAYWALL_PATH = "/settings/paywall"

test.describe("Paywall designer v2 — Content section + WYSIWYG iframe", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(PAYWALL_PATH)
    // Wait for the Content section to render
    await expect(page.getByRole("heading", { name: /content/i }).first()).toBeVisible({
      timeout: 8000,
    })
  })

  test("Hero title edit persists + iframe re-renders within 500ms warm-path", async ({
    page,
  }) => {
    const heroInput = page.locator('input[placeholder="Upgrade to Premium"]').first()

    // First edit primes the iframe (cold path may be ~1s — we don't measure it)
    await heroInput.fill("Edit 1 to prime cold path")
    await page.waitForTimeout(800)

    // Warm-path edit — measure latency from input to iframe content reflecting it
    const start = Date.now()
    await heroInput.fill("My Custom Title")
    // The iframe reads postMessage and re-renders; we verify by polling
    // contentDocument for the new title text.
    await page.waitForFunction(
      (expected) => {
        const iframe = document.querySelector("iframe") as HTMLIFrameElement | null
        const body = iframe?.contentDocument?.body
        return body ? body.innerText.includes(expected) : false
      },
      "My Custom Title",
      { timeout: 800 },
    )
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(500)

    // Click Save and verify the inline-save indicator appears
    await page.getByRole("button", { name: /save paywall/i }).click()
    await expect(page.getByText(/saved at/i)).toBeVisible({ timeout: 4000 })
  })

  test("Value props repeater — add / edit / reorder / remove", async ({ page }) => {
    const addButton = page.getByRole("button", { name: /\+ add bullet/i })

    // Empty state
    await expect(page.getByText(/no bullets yet/i)).toBeVisible()

    // Add 2 bullets
    await addButton.click()
    await addButton.click()
    const titleInputs = page.locator(
      'input[placeholder="Ad-free experience"]',
    )
    await titleInputs.nth(0).fill("First")
    await titleInputs.nth(1).fill("Second")

    // Reorder — move first down
    const moveDownButtons = page.getByLabel(/move down/i)
    await moveDownButtons.first().click()
    await expect(titleInputs.nth(0)).toHaveValue("Second")
    await expect(titleInputs.nth(1)).toHaveValue("First")

    // Remove one
    const removeButtons = page.getByLabel(/^remove$/i)
    await removeButtons.first().click()
    await expect(page.getByText(/value props \(1\)/i)).toBeVisible()
  })

  test("Hero icon SVG paste — server rejects forbidden tags", async ({ page }) => {
    // Expand the hero icon details
    await page.getByText(/hero icon \(svg path or url\)/i).click()
    const svgPaste = page.locator(
      'textarea[placeholder*="<svg viewBox"]',
    )
    await svgPaste.fill('<svg><script>alert(1)</script></svg>')
    await page.getByRole("button", { name: /save paywall/i }).click()
    // Server returns 400 with sanitization error; we surface a toast/alert
    await expect(
      page.getByText(/forbidden|sanitiz|script/i),
    ).toBeVisible({ timeout: 5000 })
  })

  test("Popular plan dropdown lists tenant products + selecting one persists", async ({
    page,
  }) => {
    const popularDropdown = page.locator('select').nth(0).filter({
      hasText: /no badge/i,
    })
    // dropdown should have ≥1 product option (test relies on seeded tenant)
    const options = await popularDropdown.locator("option").allTextContents()
    expect(options.length).toBeGreaterThan(1)
    // Pick the second option (the first is "— No badge —")
    await popularDropdown.selectOption({ index: 1 })
    await page.getByRole("button", { name: /save paywall/i }).click()
    await expect(page.getByText(/saved at/i)).toBeVisible()
  })

  test("WYSIWYG iframe — visual baseline match ≤ 1% pixel mismatch", async ({
    page,
  }) => {
    // Wait for iframe to load fully (postMessage handshake complete)
    await page.waitForTimeout(2000)
    const iframe = page.locator("iframe").first()
    await expect(iframe).toHaveScreenshot("paywall-preview-baseline.png", {
      maxDiffPixelRatio: 0.01,
    })
  })

  test("Template selector shows BrandedStack as default + legacy deprecation hint", async ({
    page,
  }) => {
    await expect(page.getByText(/branded stack/i)).toBeVisible()
    await expect(page.getByText(/v2 default/i)).toBeVisible()
    await expect(page.getByText(/deprecated.*3\.0\.0/i).first()).toBeVisible()
  })
})
