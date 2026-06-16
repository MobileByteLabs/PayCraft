import Link from "next/link"
import { createClient } from "@/lib/supabase-server"
import { requireTenant, getUserApps } from "@/lib/tenant"
import { Plus, Smartphone } from "lucide-react"
import { Card, CardBody } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ButtonLink } from "@/components/ui/button"

export default async function AppsPage() {
  const [{ tenant }, apps] = await Promise.all([requireTenant(), getUserApps()])

  return (
    <div>
      <div className="mb-8 pt-10 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight text-ink-900">Your apps</h2>
          <p className="text-ink-500 text-sm mt-1">
            Each app has its own API key, providers, and products.
          </p>
        </div>
        <ButtonLink
          href="/apps/new"
          variant="primary"
          leading={<Plus className="w-4 h-4" />}
        >
          New app
        </ButtonLink>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {apps.map((app) => (
          <Link key={app.id} href={`/apps/${app.id}`}>
            <Card className="hover:border-brand-300 transition-colors cursor-pointer">
              <CardBody className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-xl bg-brand-100 flex items-center justify-center">
                    <Smartphone className="w-5 h-5 text-brand-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-ink-900 truncate">{app.name}</div>
                    <Badge tone={app.plan === "pro" ? "success" : "neutral"}>
                      {app.plan}
                    </Badge>
                  </div>
                  {app.id === tenant.id && (
                    <span className="text-[10px] font-bold text-brand-600 uppercase tracking-wider">
                      Active
                    </span>
                  )}
                </div>
                <code className="text-[11px] text-ink-400 font-mono truncate block">
                  {app.id}
                </code>
              </CardBody>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}
