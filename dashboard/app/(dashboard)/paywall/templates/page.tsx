export const runtime = "edge"

import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { PageHeader } from "@/components/ui/page-header"
import { Badge } from "@/components/ui/badge"
import { TemplateGallery, type GalleryTemplate } from "@/components/paywall/template-gallery"

export default async function PaywallTemplatesPage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()

  const { data: templates } = await supabase.rpc("paywall_templates_list")
  const { data: paywall } = await supabase.rpc("tenant_paywall_get", {
    p_tenant_id: tenant.id,
  })

  // `workflow` is the DRAFT; a tenant who has published but never drafted still counts as having a
  // tree worth merging into, which is why both are considered.
  const row = paywall as
    | { workflow?: unknown; published_workflow?: unknown; revision?: number }
    | null
    | undefined
  const hasExistingTree = Boolean(row?.workflow ?? row?.published_workflow)

  return (
    <div>
      <PageHeader
        title="Paywall templates"
        subtitle="Start from a template, or take a newer layout while keeping the wording you wrote. Applying writes your draft — publishing stays a separate, deliberate step."
        badge={
          <Badge tone="info" dot>
            Live previews
          </Badge>
        }
      />
      <TemplateGallery
        templates={(templates as GalleryTemplate[]) ?? []}
        hasExistingTree={hasExistingTree}
        currentRevision={row?.revision ?? null}
      />
    </div>
  )
}
