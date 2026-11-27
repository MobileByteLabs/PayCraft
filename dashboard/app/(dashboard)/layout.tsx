export const runtime = "edge"

import { cookies } from "next/headers"
import { Sidebar } from "@/components/sidebar"
import { AiBubble } from "@/components/ai-bubble"
import { AppSwitcher } from "@/components/app-switcher"
import { GraceBanner } from "@/components/billing/GraceBanner"
import { ModeToggle, TestModeBanner } from "@/components/mode-toggle"
import { requireTenant, getUserApps } from "@/lib/tenant"
import { getMode } from "@/lib/mode"
import { createClient } from "@/lib/supabase-server"
import { RealtimeRefresh } from "@/components/realtime-refresh"
import { NeedsAttention } from "@/components/sync/needs-attention"
import { unreadCounts } from "@/lib/alerts"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [{ tenant }, apps] = await Promise.all([requireTenant(), getUserApps()])
  const activeTenantId =
    cookies().get("paycraft_active_app_id")?.value ?? tenant.id
  const mode = getMode()

  // Auto-claim platform ownership for the first user, then resolve whether the
  // current user is the platform owner. Drives the conditional Admin nav group.
  // supabase.rpc() returns a PostgrestBuilder which is awaitable but NOT a
  // Promise — `.catch()` isn't on it. Wrap in try/catch instead.
  const supabase = createClient()
  // Independent round trips, so in parallel: each one crosses to the Tokyo project.
  const [isPlatformOwner, alertsUnread] = await Promise.all([
    (async () => {
      // supabase.rpc() returns a PostgrestBuilder — awaitable but NOT a Promise, so no `.catch()`.
      try {
        await supabase.rpc("claim_platform_owner")
        const { data } = await supabase.rpc("is_platform_owner")
        return data === true
      } catch {
        return false
      }
    })(),
    // The Alerts nav pill. A failed count hides the pill rather than breaking every page.
    unreadCounts(supabase, tenant.id).then(
      (c) => ({ count: c.total, critical: c.critical }),
      () => ({ count: 0, critical: 0 }),
    ),
  ])

  return (
    <div className="min-h-screen bg-ink-50 antialiased">
      {/* Realtime island (invisible): live-refreshes every dashboard page when the
          active app's billing data changes — products, pricing, paywall, coupons,
          subscribers, and provider-sync status — no manual reload. */}
      <RealtimeRefresh tenantId={activeTenantId} />
      {/* GraceBanner renders nothing for tenants outside warn/grace; sits above
          nav so it's visible on every authenticated route (AC-44). */}
      <GraceBanner />
      <Sidebar
        tenantName={tenant.name}
        tenantPlan={tenant.plan}
        ownerEmail={tenant.owner_email}
        isPlatformOwner={isPlatformOwner}
        alertsUnread={alertsUnread}
        appSwitcher={
          <AppSwitcher apps={apps} activeId={activeTenantId} />
        }
      />
      <main className="ml-64 min-h-screen">
        <header className="sticky top-0 z-30 flex h-12 items-center justify-end gap-3 border-b border-ink-200/60 bg-white/80 px-10 backdrop-blur">
          <ModeToggle initialMode={mode} />
        </header>
        <TestModeBanner mode={mode} />
        {/* GLOBAL reconcile surface. Divergence is not a Products-page concern: an
            unpublished paywall, a test key in a live slot or an unsynced product is just as
            true while the operator is on Analytics. Mounted in the SHELL so it cannot be
            left out by whichever page someone happens to open. Renders null when clean. */}
        <div className="px-10 max-w-[1280px]"><NeedsAttention tenantId={tenant.id} /></div>
        <div className="px-10 pb-20 max-w-[1280px]">{children}</div>
      </main>
      {/* Persistent PayCraft AI entry point on every dashboard page. */}
      <AiBubble />
    </div>
  )
}