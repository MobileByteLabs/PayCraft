/**
 * Shown the instant a dashboard link is clicked, while the server renders the page.
 *
 * Every page here is dynamic (cookies, live Supabase reads — ~1 s from the Delhi edge to the Tokyo project,
 * Analytics several seconds). With no loading boundary a click showed nothing until that render finished, so
 * the dashboard looked frozen; this boundary is also what lets Next prefetch a page on hover. One file covers
 * all of (dashboard)/*: the sidebar and header stay, only this area swaps.
 */
export default function DashboardLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="animate-pulse pt-8">
      <span className="sr-only">Loading…</span>
      <div className="mb-2 h-8 w-56 rounded-lg bg-ink-200/70" />
      <div className="mb-8 h-4 w-96 max-w-full rounded bg-ink-200/50" />
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-24 rounded-xl border border-ink-200/60 bg-white" />
        ))}
      </div>
      <div className="rounded-xl border border-ink-200/60 bg-white">
        {[0, 1, 2, 3, 4].map((i) => (
          <div key={i} className="flex items-center gap-6 border-b border-ink-100 px-6 py-4 last:border-0">
            <div className="h-4 w-32 rounded bg-ink-200/60" />
            <div className="h-4 flex-1 rounded bg-ink-100" />
            <div className="h-4 w-20 rounded bg-ink-200/60" />
          </div>
        ))}
      </div>
    </div>
  )
}
