// The dashboard frame for the Vite app — what app/(dashboard)/layout.tsx renders, with its server reads done in
// the browser. That layout made every full page load wait ~1.2 s for the account lookup (about five round trips
// from Cloudflare's Delhi edge to the Tokyo database) before any HTML was sent; here the frame paints at once
// and the account fills in.
import { useEffect, useState } from "react"
import { Outlet } from "@tanstack/react-router"
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query"
import { createClient } from "@/lib/supabase-browser"
import { MODE_COOKIE, MODE_DEFAULT, type Mode } from "@/lib/mode-constants"
import { unreadCounts } from "@/lib/alerts"
import { Sidebar } from "@/components/sidebar"
import { AiBubble } from "@/components/ai-bubble"
import { AppSwitcher } from "@/components/app-switcher"
import { GraceBannerView } from "@/components/billing/grace-banner-view"
import { ModeToggle, TestModeBanner } from "@/components/mode-toggle"
import { AppProviders } from "@/components/app-providers"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { NeedsAttention } from "@/components/sync/needs-attention"
import DashboardLoading from "@/app/(dashboard)/loading"
import type { Tenant } from "@/lib/types"
import { SPA_REFRESH_EVENT } from "./shims/navigation"
import { ACTIVE_APP_HINT_COOKIE } from "@/lib/spa-paths"

const supabase = createClient()
const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } })

function cookie(name: string): string | undefined {
  return document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

function readMode(): Mode {
  const c = cookie(MODE_COOKIE)
  return c === "test" || c === "live" ? c : MODE_DEFAULT
}

interface Account {
  tenant: Tenant
  /** Every app the user is a member of — the app switcher lists them (its own query, off the critical path). */
  appIds: string[]
}

/** The same resolution as lib/tenant.ts#requireTenant: memberships → active-app cookie → first app. */
async function loadAccount(): Promise<Account | "signed-out" | "no-apps"> {
  const { data: session } = await supabase.auth.getSession()
  if (!session.session) return "signed-out"
  // The active app (the readable copy of the httpOnly cookie — see lib/spa-paths.ts) is read alongside the
  // memberships rather than after them, saving a round trip to Tokyo. An app the user no longer belongs to is
  // caught by the membership check below and replaced by their first app, as requireTenant does.
  const active = cookie(ACTIVE_APP_HINT_COOKIE)
  const [membershipRes, guessRes] = await Promise.all([
    supabase.rpc("tenant_admins_list_for_user"),
    active ? supabase.from("tenants").select("*").eq("id", active).maybeSingle() : null,
  ])
  if (membershipRes.error) throw new Error(membershipRes.error.message)
  const ids = ((membershipRes.data ?? []) as { tenant_id: string }[]).map((m) => m.tenant_id)
  if (!ids.length) return "no-apps"
  const tenantId = active && ids.includes(active) ? active : ids[0]
  const tenantRes =
    tenantId === active && guessRes?.data
      ? guessRes
      : await supabase.from("tenants").select("*").eq("id", tenantId).single()
  if (tenantRes.error || !tenantRes.data) throw new Error(tenantRes.error?.message ?? "app not found")
  return { tenant: tenantRes.data as Tenant, appIds: ids }
}

function useShellData(tenant: Tenant | undefined) {
  const owner = useQuery({
    queryKey: ["shell", "platform-owner"],
    queryFn: async () => {
      await supabase.rpc("claim_platform_owner")
      const { data } = await supabase.rpc("is_platform_owner")
      return data === true
    },
    enabled: !!tenant,
  })
  const alerts = useQuery({
    queryKey: ["shell", "alerts-unread", tenant?.id],
    queryFn: () => unreadCounts(supabase, tenant!.id).then((c) => ({ count: c.total, critical: c.critical })),
    enabled: !!tenant,
  })
  const grace = useQuery({
    queryKey: ["shell", "grace", tenant?.id],
    // Only the free tier has a cap (the server banner's own early exit).
    enabled: tenant?.plan === "free",
    queryFn: async () => {
      const [g, u, t] = await Promise.all([
        supabase.from("tenants").select("grace_started_at, over_limit_warned_at").eq("id", tenant!.id).maybeSingle(),
        supabase.from("tenant_subscriber_count_view").select("active_count").eq("tenant_id", tenant!.id).maybeSingle(),
        supabase.from("tier_definitions").select("max_active_subscribers").eq("tier_name", tenant!.plan).maybeSingle(),
      ])
      return {
        graceStartedAt: (g.data?.grace_started_at as string | null) ?? null,
        warnedAt: (g.data?.over_limit_warned_at as string | null) ?? null,
        active: (u.data?.active_count as number | undefined) ?? 0,
        limit: (t.data?.max_active_subscribers as number | null | undefined) ?? null,
      }
    },
  })
  return { isPlatformOwner: owner.data ?? false, alertsUnread: alerts.data, grace: grace.data }
}

/** `router.refresh()` from any component: re-read the mode / active-app cookies and refetch everything. */
function RefreshBridge({ onRefresh }: { onRefresh: () => void }) {
  const qc = useQueryClient()
  useEffect(() => {
    const handler = () => {
      onRefresh()
      void qc.invalidateQueries()
    }
    window.addEventListener(SPA_REFRESH_EVENT, handler)
    return () => window.removeEventListener(SPA_REFRESH_EVENT, handler)
  }, [qc, onRefresh])
  return null
}

function Frame() {
  const [mode, setMode] = useState<Mode>(readMode)
  const account = useQuery({ queryKey: ["shell", "account"], queryFn: loadAccount })
  const result = account.data
  const tenant = typeof result === "object" ? result.tenant : undefined
  const { isPlatformOwner, alertsUnread, grace } = useShellData(tenant)
  const appIds = typeof result === "object" ? result.appIds : undefined
  const apps = useQuery({
    queryKey: ["shell", "apps", appIds],
    enabled: !!appIds,
    queryFn: async () => {
      const { data, error } = await supabase.from("tenants").select("id, name, plan").in("id", appIds!).order("created_at")
      if (error) throw new Error(error.message)
      return (data ?? []) as { id: string; name: string; plan: string }[]
    },
  })

  useEffect(() => {
    if (result === "signed-out") {
      window.location.replace(`/auth/login?next=${encodeURIComponent(location.pathname + location.search)}`)
    } else if (result === "no-apps") {
      window.location.replace("/onboarding")
    }
  }, [result])

  return (
    <div className="min-h-screen bg-ink-50 antialiased">
      <RefreshBridge onRefresh={() => setMode(readMode())} />
      {tenant && <RealtimeRefresh tenantId={tenant.id} />}
      {grace && <GraceBannerView {...grace} />}
      <Sidebar
        tenantName={tenant?.name ?? ""}
        tenantPlan={tenant?.plan ?? ""}
        ownerEmail={tenant?.owner_email ?? ""}
        isPlatformOwner={isPlatformOwner}
        alertsUnread={alertsUnread}
        appSwitcher={tenant && apps.data ? <AppSwitcher apps={apps.data} activeId={tenant.id} /> : null}
      />
      <main className="min-h-screen lg:ml-64">
        <header className="sticky top-0 z-30 flex h-12 items-center justify-end gap-3 border-b border-ink-200/60 bg-white/80 px-4 backdrop-blur sm:px-6 lg:px-10">
          <ModeToggle initialMode={mode} />
        </header>
        <TestModeBanner mode={mode} />
        {tenant ? (
          <AppProviders tenantId={tenant.id} mode={mode} client={queryClient}>
            <div className="px-4 sm:px-6 lg:px-10 max-w-[1280px]">
              <NeedsAttention tenantId={tenant.id} />
            </div>
            <div className="px-4 pb-20 sm:px-6 lg:px-10 max-w-[1280px]">
              <Outlet />
            </div>
          </AppProviders>
        ) : (
          <div className="px-4 pb-20 sm:px-6 lg:px-10 max-w-[1280px]">
            {account.isError ? (
              <div role="alert" className="mt-10 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
                Couldn&rsquo;t load your account: {account.error.message}{" "}
                <button onClick={() => account.refetch()} className="font-semibold underline">
                  Retry
                </button>
              </div>
            ) : (
              <DashboardLoading />
            )}
          </div>
        )}
      </main>
      <AiBubble />
    </div>
  )
}

export function Shell() {
  return (
    <QueryClientProvider client={queryClient}>
      <Frame />
    </QueryClientProvider>
  )
}
