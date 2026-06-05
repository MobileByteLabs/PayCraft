import { Sidebar } from "@/components/sidebar"
import { requireTenant } from "@/lib/tenant"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { tenant } = await requireTenant()

  return (
    <div className="min-h-screen bg-ink-50 antialiased">
      <Sidebar
        tenantName={tenant.name}
        tenantPlan={tenant.plan}
        ownerEmail={tenant.owner_email}
      />
      <main className="ml-64 min-h-screen">
        <div className="px-10 pb-20 max-w-[1280px]">{children}</div>
      </main>
    </div>
  )
}
