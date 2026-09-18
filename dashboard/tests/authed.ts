/**
 * dashboard/tests/authed.ts — a `test` that cannot pass while signed out.
 *
 * WHY THIS IS NOT OPTIONAL
 * Every dashboard route redirects an unauthenticated visitor to /auth/login, and that redirect is a
 * 200 with no error text. So a suite that asserts "status < 400 and no error surface" passes
 * perfectly while testing nothing but the login page. That is exactly what happened here: a stored
 * cookie was named for a host the app did not resolve, the whole suite reported 22 green, and the
 * pages under test were never rendered once.
 *
 * A vacuous pass is worse than a failure. A failure gets fixed; a green suite that asserts nothing
 * actively buys false confidence, and it is the same defect class as a mechanism with no caller —
 * the thing exists, and nothing reaches it.
 *
 * Import `test` from here instead of `@playwright/test` and landing on the auth wall is a hard
 * failure with a message that says what to fix.
 */

import { expect, test as base } from "@playwright/test"

export const test = base.extend({
  page: async ({ page }, use) => {
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return
      // Recorded, not thrown: an assertion inside an event handler surfaces as an unhandled
      // rejection with no test context. The check below turns it into a real failure.
      if (/\/auth\/(login|signup)/.test(frame.url())) sawAuthWall.add(page)
    })
    await use(page)

    expect(
      sawAuthWall.has(page),
      "the session is not valid — every page redirected to /auth/login, so this test asserted " +
        "nothing about the app. Re-run global-setup and check the sb-*-auth-token cookie name " +
        "matches the host in NEXT_PUBLIC_SUPABASE_URL.",
    ).toBe(false)
    sawAuthWall.delete(page)
  },
})

const sawAuthWall = new WeakSet<object>()

export { expect }
