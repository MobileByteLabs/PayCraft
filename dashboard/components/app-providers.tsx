"use client"

import { createContext, useContext, useState } from "react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { createClient } from "@/lib/supabase-browser"

/**
 * Page data is read in the browser through TanStack Query: what a page showed stays cached, so going back to
 * it is instant (then refreshed in the background), and every read and action has a loading / pending / error
 * state. RLS already scopes every table and tenant RPC to the signed-in user, so the browser client reads
 * exactly what the server pages did.
 */
interface DashboardContext {
  /** The active app (tenant) — the layout resolved it from the session. */
  tenantId: string
  mode: "live" | "test"
  supabase: ReturnType<typeof createClient>
}

const Ctx = createContext<DashboardContext | null>(null)

export function AppProviders({
  tenantId,
  mode,
  children,
}: {
  tenantId: string
  mode: "live" | "test"
  children: React.ReactNode
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        // 30 s fresh: navigating back and forth re-uses the data; realtime + focus refetch keep it current.
        defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
      }),
  )
  const [supabase] = useState(createClient)
  return (
    <QueryClientProvider client={queryClient}>
      <Ctx.Provider value={{ tenantId, mode, supabase }}>{children}</Ctx.Provider>
    </QueryClientProvider>
  )
}

export function useDashboard(): DashboardContext {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error("useDashboard outside <AppProviders>")
  return ctx
}
