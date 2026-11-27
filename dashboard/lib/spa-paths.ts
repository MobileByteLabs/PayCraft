/**
 * The signed-in dashboard is a Vite app (spa/); these are its top-level paths — the folders of app/(dashboard).
 * The middleware serves its shell for them, and its link/router adapters navigate them in-app. Everything else
 * (the public site, /auth, /onboarding, /api) stays on Next.js.
 */
export const SPA_SEGMENTS: ReadonlySet<string> = new Set([
  "admin",
  "ai",
  "alerts",
  "analytics",
  "apps",
  "audit",
  "billing",
  "coupons",
  "dashboard",
  "paywall",
  "products",
  "providers",
  "settings",
  "subscribers",
  "team",
  "upgrade",
  "upi-payments",
  "webhooks",
])

export function isSpaPath(pathname: string): boolean {
  return SPA_SEGMENTS.has(pathname.split("/")[1] ?? "")
}

/**
 * The active app, readable by the Vite shell. The real choice is the httpOnly `paycraft_active_app_id` (set by
 * /api/apps/switch); the middleware and that route keep this copy in step so the shell can read the right app's
 * row in parallel with the membership check instead of after it.
 */
export const ACTIVE_APP_HINT_COOKIE = "pc_active_app"

/** Where to return after sign-in: the dashboard page that sent the visitor to /auth/login (set by the login page). */
export const AFTER_LOGIN_COOKIE = "pc_after_login"

/** A same-site dashboard path, or null — never an open redirect (`//evil.com`, `https://…`, `/\\evil`). */
export function safeAfterLogin(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) return null
  return isSpaPath(next.split(/[?#]/)[0]) ? next : null
}
