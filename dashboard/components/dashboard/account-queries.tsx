"use client"

import { useQuery } from "@tanstack/react-query"
import { useDashboard } from "@/components/app-providers"
import type { Tenant } from "@/lib/types"

/**
 * Account-level reads shared by the overview, apps, audit, team, upgrade and admin pages. Browser client +
 * RLS: the rows are exactly what the server pages read with the user's session.
 */

export type AccountApp = { id: string; name: string; plan: string; owner_email: string | null }

/** Every app the signed-in user is a member of (the browser twin of `getUserApps()`). */
export function useAccountApps() {
  const { supabase } = useDashboard()
  return useQuery({
    queryKey: ["apps", "account"],
    queryFn: async () => {
      const { data: memberships, error } = await supabase.rpc("tenant_admins_list_for_user")
      if (error) throw new Error(error.message)
      const ids = ((memberships ?? []) as { tenant_id: string }[]).map((m) => m.tenant_id)
      if (!ids.length) return [] as AccountApp[]
      const { data, error: appsError } = await supabase
        .from("tenants")
        .select("id, name, plan, owner_email")
        .in("id", ids)
        .order("created_at")
      if (appsError) throw new Error(appsError.message)
      return (data ?? []) as AccountApp[]
    },
  })
}

/** The active app's tenant row (plan, limits, owner email). */
export function useActiveTenant() {
  const { tenantId, supabase } = useDashboard()
  return useQuery({
    queryKey: ["tenant-row", tenantId],
    queryFn: async () => {
      const { data, error } = await supabase.from("tenants").select("*").eq("id", tenantId).single()
      if (error) throw new Error(error.message)
      return data as Tenant
    },
  })
}

/** Whether the signed-in user owns this PayCraft instance. The first deployer self-claims (idempotent RPC). */
export function usePlatformOwner() {
  const { supabase } = useDashboard()
  return useQuery({
    queryKey: ["platform-owner"],
    queryFn: async () => {
      await supabase.rpc("claim_platform_owner")
      const { data, error } = await supabase.rpc("is_platform_owner")
      if (error) throw new Error(error.message)
      return data === true
    },
  })
}

export function LoadingRows({ label, rows = 3 }: { label: string; rows?: number }) {
  return (
    <div role="status" aria-busy="true" className="animate-pulse divide-y divide-ink-100">
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

export function LoadError({ what, error, onRetry }: { what: string; error: Error; onRetry: () => void }) {
  return (
    <div role="alert" className="p-8 text-center text-sm text-danger-700">
      Couldn&rsquo;t load {what}: {error.message}{" "}
      <button onClick={onRetry} className="font-semibold underline">
        Retry
      </button>
    </div>
  )
}
