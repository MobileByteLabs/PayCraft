export const runtime = "edge"

import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { PageHeader } from "@/components/ui/page-header"
import { type EditorCoupon, ExitSurveyEditor } from "@/components/paywall/exit-survey-editor"
import { DEFAULT_REASONS, type SurveyDraft } from "@/lib/exit-survey-config"

export default async function ExitSurveyPage() {
  const { tenant } = await requireTenant()
  const supabase = createClient()
  const [survey, coupons, products] = await Promise.all([
    supabase.from("tenant_exit_survey")
      .select("enabled,title,reasons,survey_cap_days,offer_hours")
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
    supabase.rpc("tenant_coupons_list", { p_tenant_id: tenant.id }),
    supabase.from("tenant_products").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).eq("active", true),
  ])

  // Every tenant has a row (migration 181 seeds it); the defaults cover a read that raced the seed.
  const initial: SurveyDraft = survey.data
    ? {
      enabled: survey.data.enabled,
      title: survey.data.title,
      reasons: survey.data.reasons ?? DEFAULT_REASONS,
      survey_cap_days: survey.data.survey_cap_days,
      offer_hours: survey.data.offer_hours,
    }
    : { enabled: true, title: "Before you go — what stopped you?", reasons: DEFAULT_REASONS, survey_cap_days: 7, offer_hours: 48 }

  return (
    <div>
      <PageHeader
        title="Exit survey"
        subtitle="Ask buyers who leave without paying why — and answer with a win-back discount or a message. Changes reach apps and your website within 5 minutes."
      />
      <ExitSurveyEditor
        initial={initial}
        coupons={((coupons.data ?? []) as (EditorCoupon & { active: boolean })[]).filter((c) => c.active)}
        productCount={products.count ?? 0}
      />
    </div>
  )
}
