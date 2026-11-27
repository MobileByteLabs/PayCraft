"use client"

/** Throws a Supabase `{ data, error }` result's error so useQuery shows it; returns the data otherwise. */
export function unwrap<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message)
  return res.data
}

/** Skeleton shown while a provider page's data loads (same shape as the coupons pilot). */
export function QueryLoading({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-busy="true" className="animate-pulse space-y-3">
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="h-24 rounded-xl border border-ink-200 bg-ink-50" />
      ))}
    </div>
  )
}

export function QueryError({ what, error, onRetry }: { what: string; error: Error; onRetry: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-danger-200 bg-danger-50 p-6 text-center text-sm text-danger-700">
      Couldn&rsquo;t load {what}: {error.message}{" "}
      <button onClick={onRetry} className="font-semibold underline">
        Retry
      </button>
    </div>
  )
}
