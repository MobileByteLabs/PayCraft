import { cookies } from "next/headers"
import { Sidebar } from "@/components/sidebar"
import { AppSwitcher } from "@/components/app-switcher"
import { requireTenant, getUserApps } from "@/lib/tenant"
import { createClient } from "@/lib/supabase-server"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [{ tenant }, apps] = await Promise.all([requireTenant(), getUserApps()])
  const activeTenantId =
    cookies().get("paycraft_active_app_id")?.value ?? tenant.id

  // Auto-claim platform ownership for the first user, then resolve whether the
  // current user is the platform owner. Drives the conditional Admin nav group.
  // supabase.rpc() returns a PostgrestBuilder which is awaitable but NOT a
  // Promise — `.catch()` isn't on it. Wrap in try/catch instead.
  const supabase = createClient()
  let isPlatformOwner = false
  try {
    await supabase.rpc("claim_platform_owner")
    const { data } = await supabase.rpc("is_platform_owner")
    isPlatformOwner = data === true
  } catch {
    isPlatformOwner = false
  }

  return (
    <div className="min-h-screen bg-ink-50 antialiased">
      <Sidebar
        tenantName={tenant.name}
        tenantPlan={tenant.plan}
        ownerEmail={tenant.owner_email}
        isPlatformOwner={isPlatformOwner}
        appSwitcher={
          <AppSwitcher apps={apps} activeId={activeTenantId} />
        }
      />
      <main className="ml-64 min-h-screen">
        <div className="px-10 pb-20 max-w-[1280px]">{children}</div>
      </main>
    </div>
  )
}
