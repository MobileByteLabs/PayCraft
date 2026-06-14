import { cookies } from "next/headers"
import { Sidebar } from "@/components/sidebar"
import { AppSwitcher } from "@/components/app-switcher"
import { requireTenant, getUserApps } from "@/lib/tenant"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const [{ tenant }, apps] = await Promise.all([requireTenant(), getUserApps()])
  const activeTenantId =
    cookies().get("paycraft_active_app_id")?.value ?? tenant.id

  return (
    <div className="min-h-screen bg-ink-50 antialiased">
      <Sidebar
        tenantName={tenant.name}
        tenantPlan={tenant.plan}
        ownerEmail={tenant.owner_email}
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
