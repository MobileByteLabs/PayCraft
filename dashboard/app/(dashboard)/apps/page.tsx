export const runtime = "edge"

import Link from "next/link"
import { createClient } from "@/lib/supabase-server"
import { requireTenant, getUserApps } from "@/lib/tenant"
import { Plus, Smartphone } from "lucide-react"
import { Card, CardBody } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { ButtonLink } from "@/components/ui/button"

/**
 * Every app in the account, and the route into the per-app drill-down.
 *
 * THE COLUMN THAT EARNS ITS PLACE IS SETUP. An app is only really selling when it has products
 * AND a provider AND a published paywall. Missing any one of the three, it still appears in this
 * list, still looks configured, sells nothing, and raises no error anywhere in the product.
 *
 * Before this the card showed a name, a plan badge and a raw UUID, so a fully live app and one
 * with no products at all rendered identically. Now each card states which of the three pieces it
 * has, because "70% complete" cannot tell you WHICH piece is missing and that is the only part a
 * reader can act on.
 *
 * Incomplete renders NEUTRAL, never red: a half-configured app is normally work in progress, and
 * colouring it as a fault would make an ordinary state look like an outage.
 */
export default async function AppsPage() {
  const [{ tenant }, apps] = await Promise.all([requireTenant(), getUserApps()])
  const supabase = createClient()

  // Un-filtered by tenant_id on purpose: tenant-admin RLS returns exactly the rows this account
  // owns, which is the same pattern the account overview uses for its aggregate.
  const [productsRes, providersRes, offeringsRes] = await Promise.all([
    supabase.from("tenant_products").select("tenant_id").eq("active", true),
    supabase.from("tenant_providers").select("tenant_id").eq("is_active", true),
    supabase.from("tenant_offerings").select("tenant_id"),
  ])

  const countBy = (rows: { tenant_id: string }[] | null) => {
    const m = new Map<string, number>()
    for (const r of rows ?? []) m.set(r.tenant_id, (m.get(r.tenant_id) ?? 0) + 1)
    return m
  }
  const productsBy = countBy(productsRes.data)
  const providersBy = countBy(providersRes.data)
  const offeringsBy = countBy(offeringsRes.data)

  return (
    <div>
      <div className="mb-8 pt-10 flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-extrabold tracking-tight text-ink-900">Your apps</h2>
          <p className="text-ink-500 text-sm mt-1">
            Providers are shared from the account. Products and paywalls belong to each app.
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
        {apps.map((app) => {
          const pieces = [
            { label: "Products", ok: (productsBy.get(app.id) ?? 0) > 0 },
            { label: "Providers", ok: (providersBy.get(app.id) ?? 0) > 0 },
            { label: "Paywall", ok: (offeringsBy.get(app.id) ?? 0) > 0 },
          ]
          const ready = pieces.every((p) => p.ok)

          return (
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

                  {/* SETUP. Three labelled marks rather than one percentage, so the reader can see
                      which piece is missing instead of only how much is. */}
                  <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
                    {pieces.map((p) => (
                      <span
                        key={p.label}
                        className="inline-flex items-center gap-1.5 text-[11px] text-ink-600"
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${
                            p.ok ? "bg-success-500" : "border border-ink-300"
                          }`}
                        />
                        {p.label}
                      </span>
                    ))}
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <code className="text-[11px] text-ink-400 font-mono truncate">
                      {app.id}
                    </code>
                    {!ready && (
                      <span className="shrink-0 rounded-full border border-ink-200 px-2 py-0.5 text-[10px] font-medium text-ink-500">
                        Setup
                      </span>
                    )}
                  </div>
                </CardBody>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
