import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { notFound } from "next/navigation"
import { Card, CardBody } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Copy, KeyRound, Package, Plug } from "lucide-react"
import { CopyButton } from "@/components/ui/copy-button"

export default async function AppDetailPage({
  params,
}: {
  params: { id: string }
}) {
  const supabase = createClient()
  const { tenant: activeApp } = await requireTenant()

  // Verify the requesting user is a member of the target app.
  const { data: membership } = await supabase
    .from("tenant_admins")
    .select("role")
    .eq("tenant_id", params.id)
    .maybeSingle()

  if (!membership) notFound()

  const { data: app } = await supabase
    .from("tenants")
    .select("*")
    .eq("id", params.id)
    .single()

  if (!app) notFound()

  const { count: productsCount } = await supabase
    .from("tenant_products")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", params.id)

  const { count: subscribersCount } = await supabase
    .from("subscriptions")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", params.id)

  return (
    <div>
      <div className="mb-8 pt-10">
        <div className="flex items-center gap-3">
          <h2 className="text-3xl font-extrabold tracking-tight text-ink-900">{app.name}</h2>
          <Badge tone={app.plan === "pro" ? "success" : "neutral"}>{app.plan}</Badge>
          {app.id === activeApp.id && <Badge tone="brand">Active</Badge>}
        </div>
        <p className="text-ink-500 text-sm mt-1">App overview and credentials</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <Card>
          <CardBody className="p-5 flex items-center gap-4">
            <Package className="w-8 h-8 text-brand-400" />
            <div>
              <div className="text-2xl font-bold text-ink-900">{productsCount ?? 0}</div>
              <div className="text-xs text-ink-500">Products</div>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="p-5 flex items-center gap-4">
            <Plug className="w-8 h-8 text-success-400" />
            <div>
              <div className="text-2xl font-bold text-ink-900">{subscribersCount ?? 0}</div>
              <div className="text-xs text-ink-500">Active subscribers</div>
            </div>
          </CardBody>
        </Card>
      </div>

      <Card>
        <div className="px-6 py-4 border-b border-ink-100">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-ink-400" />
            <h3 className="font-bold text-ink-900">API Keys</h3>
          </div>
        </div>
        <CardBody className="p-6 space-y-4">
          {[
            { label: "Live publishable key", value: app.api_key_live },
            { label: "Test publishable key", value: app.api_key_test },
          ].map((k) => (
            <div key={k.label} className="space-y-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-ink-400 block">
                {k.label}
              </label>
              <div className="flex items-center gap-2">
                <code className="flex-1 text-xs font-mono text-ink-700 bg-ink-50 border border-ink-200 px-3 py-2 rounded-lg truncate">
                  {k.value}
                </code>
                <CopyButton value={k.value} />
              </div>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  )
}
