"use client"

import { useRouter } from "next/navigation"
import { useTransition } from "react"
import { clsx } from "clsx"
import { FlaskConical, Zap } from "lucide-react"

type Mode = "test" | "live"

const COOKIE = "pc_mode"
const MAX_AGE = 60 * 60 * 24 * 365 // 1 year

/**
 * Stripe-style test/live mode toggle. Renders a pill-shaped switch top-right
 * of the dashboard header. Persists choice in `pc_mode` cookie; server components
 * read it via `getMode()` from `@/lib/mode`.
 */
export function ModeToggle({ initialMode }: { initialMode: Mode }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function setMode(next: Mode) {
    if (next === initialMode) return
    document.cookie = `${COOKIE}=${next}; path=/; max-age=${MAX_AGE}; samesite=lax`
    startTransition(() => router.refresh())
  }

  const isTest = initialMode === "test"

  return (
    <div
      className={clsx(
        "inline-flex items-center rounded-full border p-0.5 text-xs font-medium select-none transition-colors",
        isTest
          ? "border-amber-300 bg-amber-50"
          : "border-gray-200 bg-white",
        isPending && "opacity-60 pointer-events-none",
      )}
      title={
        isTest
          ? "Editing test-mode data. Switch to Live for production."
          : "Editing live-mode data. Switch to Test for development."
      }
    >
      <button
        type="button"
        onClick={() => setMode("test")}
        className={clsx(
          "flex items-center gap-1 rounded-full px-3 py-1 transition-colors",
          isTest ? "bg-amber-500 text-white" : "text-gray-600 hover:text-gray-900",
        )}
      >
        <FlaskConical className="h-3.5 w-3.5" />
        Test mode
      </button>
      <button
        type="button"
        onClick={() => setMode("live")}
        className={clsx(
          "flex items-center gap-1 rounded-full px-3 py-1 transition-colors",
          !isTest ? "bg-emerald-600 text-white" : "text-gray-600 hover:text-gray-900",
        )}
      >
        <Zap className="h-3.5 w-3.5" />
        Live mode
      </button>
    </div>
  )
}

/**
 * Thin top banner that materializes when test mode is active — borrows the
 * Stripe pattern (amber pinstripe under the header) so the operator can never
 * forget they're editing test data.
 */
export function TestModeBanner({ mode }: { mode: Mode }) {
  if (mode !== "test") return null
  return (
    <div className="bg-amber-100 border-b border-amber-300 px-10 py-1.5 text-xs text-amber-900 flex items-center gap-2">
      <FlaskConical className="h-3.5 w-3.5" />
      <span>
        <strong>Test mode</strong> — payment links, webhooks, and subscribers shown here are sandboxed.
        Use Stripe test cards (e.g. <code className="font-mono">4242 4242 4242 4242</code>).
      </span>
    </div>
  )
}
