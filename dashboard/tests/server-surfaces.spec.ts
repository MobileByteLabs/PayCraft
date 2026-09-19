/**
 * dashboard/tests/server-surfaces.spec.ts
 *
 * End-to-end coverage for the dashboard surfaces that broke in production and were caught by hand.
 *
 * WHAT THIS CATCHES THAT THE JEST SUITE CANNOT
 * `__tests__/**` mocks the Supabase client, so it asserts how a handler behaves given rows the test
 * author invented. Every dashboard defect this session was instead about the wiring AROUND the
 * handler — a route with no caller, a component imported by nothing, a duplicate React key from a
 * per-locale table rendered per-currency, a confirmation guard nobody exercised. Those need a real
 * browser hitting a real server against a real database, which is what this file is.
 *
 * Signed in via the shared `global-setup.ts` session, against the seeded tenant.
 */

import { expect, test } from "./authed"

/**
 * EVERY ROUTE RENDERS.
 *
 * Five API routes and one component were deleted as unreachable in one change. Nothing in the repo
 * would have failed if that deletion had also taken something live with it: there was no test that
 * simply opened each page. This is that test, enumerated so a new route is a one-line addition.
 */
const ROUTES = [
  "/dashboard",
  "/products",
  "/products/new",
  "/providers",
  "/providers/platform",
  "/providers/routing",
  "/providers/stripe",
  "/providers/razorpay",
  "/providers/google-play",
  "/providers/app-store",
  "/coupons",
  "/team",
  "/settings",
  "/settings/api-keys",
  "/settings/provider-accounts",
  "/paywall",
  "/subscribers",
  "/audit",
  "/webhooks",
  "/analytics",
  "/apps",
  "/billing",
]

for (const route of ROUTES) {
  test(`route renders without an error surface: ${route}`, async ({ page }) => {
    const res = await page.goto(route, { waitUntil: "domcontentloaded" })
    expect(res?.status(), `${route} must not 4xx/5xx`).toBeLessThan(400)

    // A Next error boundary renders 200 with an error body, so status alone is not proof.
    const errorText = page.locator(
      "text=/Application error|Unhandled Runtime Error|This page could not be found/i",
    )
    await expect(errorText, `${route} rendered an error surface`).toHaveCount(0)
  })
}

/**
 * THE DUPLICATE-CURRENCY DEFECT.
 *
 * `tenant_pricing` is per-LOCALE. The pricing matrix keyed its rows by CURRENCY, so DE/FR/ES/IT all
 * produced "EUR" — the same currency rendered four times, with duplicate React keys logged on every
 * render. It shipped because nothing ever opened a product detail page with multi-locale pricing.
 */
test("product detail: the pricing matrix shows each currency once", async ({ page }) => {
  const consoleErrors: string[] = []
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text())
  })

  await page.goto("/products", { waitUntil: "domcontentloaded" })
  const first = page.locator('a[href^="/products/"]').filter({ hasNotText: "New" }).first()
  const href = await first.getAttribute("href")
  test.skip(!href || href.endsWith("/new"), "no product seeded to inspect")

  await page.goto(href!, { waitUntil: "domcontentloaded" })

  const matrix = page.locator('div:has(> div > h3:text-is("Pricing matrix"))').first()
  if (await matrix.count()) {
    const codes = await matrix.locator("span.font-mono").allInnerTexts()
    const trimmed = codes.map((c) => c.trim()).filter(Boolean)
    expect(
      new Set(trimmed).size,
      `a currency appears more than once: ${trimmed.join(", ")}`,
    ).toBe(trimmed.length)
  }

  expect(
    consoleErrors.filter((e) => e.includes("same key")),
    "duplicate React keys mean two rows claim the same identity",
  ).toEqual([])
})

/**
 * THE PROVIDER-VISIBILITY GAP.
 *
 * Which ids a product holds at each provider lived only in columns nobody rendered, so "why did this
 * open Stripe instead of Razorpay?" could only be answered by querying the database — which is
 * exactly what kept happening.
 */
test("product detail: the Providers section states each provider's state", async ({ page }) => {
  await page.goto("/products", { waitUntil: "domcontentloaded" })
  const href = await page
    .locator('a[href^="/products/"]')
    .filter({ hasNotText: "New" })
    .first()
    .getAttribute("href")
  test.skip(!href || href.endsWith("/new"), "no product seeded to inspect")

  await page.goto(href!, { waitUntil: "domcontentloaded" })

  const section = page.locator('h3:text-is("Providers")')
  await expect(section, "the Providers section must be on the product detail page").toHaveCount(1)

  // One expandable row per provider, each stating active/inactive and connected/not.
  for (const label of ["Stripe", "Razorpay", "Google Play", "App Store"]) {
    const row = page.locator(`details:has(summary:has-text("${label}"))`).first()
    await expect(row, `${label} must have a row`).toHaveCount(1)
    const summary = await row.locator("summary").innerText()
    expect(
      /active|inactive/i.test(summary) && /connected/i.test(summary),
      `${label}'s row must state its state, got: ${summary.replace(/\n/g, " | ")}`,
    ).toBe(true)
  }
})

/**
 * THE CONFIRMATION GUARD.
 *
 * `/api/sync/all` takes a `confirm_count` so an operator cannot approve a 2-item report and have a
 * 12-item drain run. The guard existed and had no test; this exercises the mismatch branch, which is
 * the one that matters — the happy path is exercised by every real click.
 */
test("sync/all refuses a stale confirmation count", async ({ page, request }) => {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" })

  const tenantId = await page.evaluate(async () => {
    const r = await fetch("/api/apps")
    if (!r.ok) return null
    const apps = await r.json()
    return Array.isArray(apps) && apps.length ? apps[0].id : null
  })
  test.skip(!tenantId, "no app available for the signed-in user")

  const stale = await page.evaluate(async (id) => {
    const r = await fetch("/api/sync/all", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenant_id: id, confirm_count: 9999 }),
    })
    return { status: r.status, body: await r.json().catch(() => ({})) }
  }, tenantId)

  expect(
    [409, 400],
    `a confirmation that no longer matches the report must be refused, got ${stale.status}`,
  ).toContain(stale.status)
  expect(JSON.stringify(stale.body)).toMatch(/count_mismatch|requiresConfirmation|drift set changed/i)
})

/**
 * THE DRIFT REPORT IS HONEST.
 *
 * A finding whose suggested action cannot clear it trains the operator to ignore the banner. The
 * `active-provider-zero-links` detector counted payment links only, so a fully-synced Razorpay —
 * which issues PLANS, not links — was reported forever, recommending the sync that had just run.
 */
test("drift: every finding names a kind and an action", async ({ page }) => {
  await page.goto("/dashboard", { waitUntil: "domcontentloaded" })

  const tenantId = await page.evaluate(async () => {
    const r = await fetch("/api/apps")
    if (!r.ok) return null
    const apps = await r.json()
    return Array.isArray(apps) && apps.length ? apps[0].id : null
  })
  test.skip(!tenantId, "no app available for the signed-in user")

  const drift = await page.evaluate(async (id) => {
    const r = await fetch(`/api/sync/drift?tenant_id=${id}&force=1`)
    return { status: r.status, body: await r.json().catch(() => ({})) }
  }, tenantId)

  expect(drift.status).toBe(200)
  expect(Array.isArray(drift.body.findings)).toBe(true)
  for (const f of drift.body.findings) {
    expect(f.kind, "a finding without a kind cannot be grouped or acted on").toBeTruthy()
    expect(f.detail, `finding ${f.kind} must say what is wrong`).toBeTruthy()
    expect(f.action_hint, `finding ${f.kind} must say what to do about it`).toBeTruthy()
  }
})

/**
 * THE GLOBAL SYNC SURFACE IS MOUNTED IN THE SHELL.
 *
 * Divergence is not a Products-page concern; it is just as true while the operator is on Analytics.
 * The banner was once imported by nothing at all, so the only reachable sync was a per-row button.
 */
test("the needs-attention surface is reachable from any page, not just Products", async ({ page }) => {
  await page.goto("/analytics", { waitUntil: "domcontentloaded" })
  await page.waitForTimeout(1500)

  // It renders null when clean, so absence is only a failure if the drift report is non-empty.
  const tenantId = await page.evaluate(async () => {
    const r = await fetch("/api/apps")
    if (!r.ok) return null
    const apps = await r.json()
    return Array.isArray(apps) && apps.length ? apps[0].id : null
  })
  test.skip(!tenantId, "no app available for the signed-in user")

  const count = await page.evaluate(async (id) => {
    const r = await fetch(`/api/sync/drift?tenant_id=${id}`)
    const b = await r.json().catch(() => ({ findings: [] }))
    return (b.findings ?? []).length
  }, tenantId)

  if (count > 0) {
    await expect(
      page.locator("text=Needs attention").first(),
      "findings exist but the shell-mounted banner did not render on /analytics",
    ).toBeVisible({ timeout: 10_000 })
  }
})
