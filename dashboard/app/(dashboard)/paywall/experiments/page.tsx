export const runtime = "edge"

import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { PageHeader } from "@/components/ui/page-header"
import { type EditorOffering, ExperimentsEditor } from "@/components/paywall/experiments-editor"
import type { Experiment } from "@/lib/experiments"

export default async function ExperimentsPage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()
  const [experiments, offerings] = await Promise.all([
    supabase.from("paywall_experiments")
      .select("key,name,status,variants,started_at,stopped_at")
      .eq("tenant_id", tenant.id)
      .order("created_at", { ascending: false }),
    supabase.from("tenant_offerings").select("id,identifier,display_name").eq("tenant_id", tenant.id).eq("active", true),
  ])

  return (
    <div>
      <PageHeader
        title="Experiments"
        subtitle="Test which offering your paywall sells. The SDK assigns each device a variant by weight and keeps it; a stopped experiment can't be restarted."
      />
      <ExperimentsEditor
        initial={(experiments.data ?? []) as Experiment[]}
        offerings={(offerings.data ?? []) as EditorOffering[]}
      />
    </div>
  )
}
