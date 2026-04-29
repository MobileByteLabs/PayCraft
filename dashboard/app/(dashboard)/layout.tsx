import { Sidebar } from "@/components/sidebar"
import { requireTenant } from "@/lib/tenant"

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const { tenant } = await requireTenant()

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar tenantName={tenant.name} />
      <main className="flex-1 p-8">{children}</main>
    </div>
  )
}
