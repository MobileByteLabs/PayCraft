"use client"

import { useEffect, useRef } from "react"
import { useQueryClient } from "@tanstack/react-query"
import { useRouter } from "next/navigation"
import { createClient } from "@/lib/supabase-browser"

// Tenant-scoped billing tables the dashboard renders. All carry a tenant_id and
// a tenant_admin (or public-read) RLS SELECT policy, and are in the
// `supabase_realtime` publication (migration 081) with REPLICA IDENTITY FULL so
// the tenant_id filter works on UPDATE/DELETE too.
const DEFAULT_TABLES = [
  "tenant_products",
  "tenant_pricing",
  "tenant_paywall",
  "tenant_coupons",
  "subscriptions",
]

/**
 * Invisible realtime island. Subscribes to Postgres `postgres_changes` on the
 * active tenant's billing tables and refreshes the current server components on
 * any change — so product / price / paywall / coupon / subscriber updates (and
 * live provider-sync status writes) appear WITHOUT a manual reload. Realtime
 * respects RLS via the signed-in admin's JWT, and the `tenant_id=eq` filter
 * scopes delivery to the active app.
 *
 * Changes are debounced (a single sync touches several rows) into one refresh.
 * Mounted once in the dashboard layout, so every page is live.
 */
export function RealtimeRefresh({
  tenantId,
  tables = DEFAULT_TABLES,
}: {
  tenantId: string
  tables?: string[]
}) {
  const router = useRouter()
  const queryClient = useQueryClient()
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!tenantId) return
    const supabase = createClient()
    const channel = supabase.channel(`dash-rt:${tenantId}`)

    for (const table of tables) {
      channel.on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table,
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          if (timer.current) clearTimeout(timer.current)
          timer.current = setTimeout(() => {
            router.refresh()
            // Pages that read in the browser (TanStack Query) refetch too.
            void queryClient.invalidateQueries()
          }, 300)
        }
      )
    }
    channel.subscribe()

    return () => {
      if (timer.current) clearTimeout(timer.current)
      void supabase.removeChannel(channel)
    }
    // tables is a stable module constant by default; join guards an inline array.
  }, [tenantId, tables.join(","), router, queryClient])

  return null
}
