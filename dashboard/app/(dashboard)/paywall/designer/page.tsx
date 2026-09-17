export const runtime = "edge"

import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { PageHeader } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { PaywallTreeEditor } from "@/components/paywall/tree/PaywallTreeEditor"
import type { Json } from "@/components/paywall/tree/edit"

export default async function PaywallDesignerPage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const { data: paywall } = await supabase.rpc("tenant_paywall_get", { p_tenant_id: tenant.id })
  const row = paywall as
    | {
        workflow?: Json | null
        published_workflow?: Json | null
        revision?: number | null
        published_revision?: number | null
      }
    | null
    | undefined

  // The draft is what gets edited. A tenant who published before ever drafting still has something
  // worth opening, so the published tree is the fallback rather than an empty canvas.
  const initial = row?.workflow ?? row?.published_workflow ?? null

  return (
    <div>
      <PageHeader
        title="Paywall designer"
        subtitle="Edit the component tree the SDK renders. Saving writes your draft; publishing is what reaches devices."
        badge={
          <Badge tone="info" dot>
            Tree editor
          </Badge>
        }
      />
      {initial ? (
        <PaywallTreeEditor
          initialWorkflow={initial}
          initialRevision={row?.revision ?? null}
          publishedRevision={row?.published_revision ?? null}
        />
      ) : (
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          No component tree yet — pick one from{" "}
          <a className="underline" href="/paywall/templates">
            the template gallery
          </a>{" "}
          to start.
        </div>
      )}
    </div>
  )
}
