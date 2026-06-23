// dashboard/lib/analytics.ts
//
// Client-side Google Analytics 4 (gtag) wrapper. Free, and NOT a secret —
// the measurement id (NEXT_PUBLIC_GA_ID, e.g. "G-XXXXXXXX") is public by
// design. Every call is a no-op when GA is unconfigured or when running
// server-side, so it's safe to import anywhere.

export const GA_ID = process.env.NEXT_PUBLIC_GA_ID ?? ""

type GtagParams = Record<string, unknown>

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void
    dataLayer?: unknown[]
  }
}

function ready(): boolean {
  return typeof window !== "undefined" && typeof window.gtag === "function" && GA_ID !== ""
}

/** Track a custom product event (e.g. "signup", "checkout_started", "subscription_created"). */
export function trackEvent(name: string, params: GtagParams = {}): void {
  if (!ready()) return
  window.gtag!("event", name, params)
}

/** Track a client-side error as a GA `exception` event — a rough error counter (no stack traces). */
export function trackException(description: string, fatal = false): void {
  if (!ready()) return
  window.gtag!("event", "exception", { description, fatal })
}

/** Manual pageview. GA4 auto-tracks navigations once loaded; use this only for custom cases. */
export function pageview(path: string): void {
  if (!ready()) return
  window.gtag!("event", "page_view", { page_path: path })
}
