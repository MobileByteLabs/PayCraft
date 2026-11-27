"use client"

import { useQuery } from "@tanstack/react-query"
import { useDashboard } from "@/components/app-providers"

/** Pulsing placeholder rows while a query is pending (same shape as the coupons pilot). */
export function LoadingRows({ label, rows = 3, className = "" }: { label: string; rows?: number; className?: string }) {
  return (
    <div role="status" aria-busy="true" className={`animate-pulse divide-y divide-ink-100 ${className}`}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-6 px-6 py-4">
          <div className="h-4 w-28 rounded bg-ink-200/70" />
          <div className="h-4 flex-1 rounded bg-ink-100" />
          <div className="h-4 w-16 rounded bg-ink-200/70" />
        </div>
      ))}
    </div>
  )
}

/** A card-sized skeleton for a whole section. */
export function LoadingCard({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div className="rounded-xl border border-ink-200 bg-white shadow-sm overflow-hidden">
      <LoadingRows label={label} rows={rows} />
    </div>
  )
}

export function LoadError({ what, error, retry }: { what: string; error: Error; retry: () => void }) {
  return (
    <div role="alert" className="rounded-xl border border-danger-100 bg-danger-50 p-6 text-center text-sm text-danger-700">
      Couldn&rsquo;t load {what}: {error.message}{" "}
      <button onClick={retry} className="font-semibold underline">
        Retry
      </button>
    </div>
  )
}

/** fetch → JSON, throwing the route's `error` field (or the status) on a non-2xx. */
export async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(String((body as { error?: string }).error ?? `HTTP ${res.status}`))
  return body as T
}

export type TenantRow = { plan: "free" | "pro" | "enterprise" | null; owner_email: string | null }

/** The active app's plan + owner email (what server pages took from requireTenant()). */
export function useTenantRow() {
  const { tenantId, supabase } = useDashboard()
  return useQuery({
    queryKey: ["tenant", tenantId, "plan,owner_email"],
    queryFn: async () => {
      const { data, error } = await supabase.from("tenants").select("plan, owner_email").eq("id", tenantId).single()
      if (error) throw new Error(error.message)
      return data as TenantRow
    },
  })
}
