// PayCraft Brain — typed metrics loader.
//
// Reads the tenant's analytics views (RLS-scoped; the cookie-bound client only sees the
// caller's rows) and assembles one typed Metrics object the deterministic engine evaluates.
// No external/AI calls — pure Supabase reads.

import type { SupabaseClient } from "@supabase/supabase-js"

export interface Metrics {
  mrrDollars: number
  active: number
  trial: number
  canceled: number
  arpu: number
  trialToPaid: number | null // active / (active + trial)
  churnRate: number | null
  annualShare: number | null // annual-plan subscribers / total
  webhookSuccess: number | null
  hasAnnualPlan: boolean
  popularPlanSku: string | null
  primaryColor: string | null
  valuePropsCount: number
  planCount: number
}

function isAnnualSku(sku: unknown): boolean {
  const s = String(sku ?? "").toLowerCase()
  return s.includes("annual") || s.includes("year")
}

export async function loadMetrics(supabase: SupabaseClient, tenantId: string): Promise<Metrics> {
  const single = async (view: string) => {
    const { data } = await supabase.from(view).select("*").eq("tenant_id", tenantId).maybeSingle()
    return (data as Record<string, unknown> | null) ?? null
  }

  const [mrr, subs, churn, webhook, paywall] = await Promise.all([
    single("tenant_mrr_view"),
    single("tenant_subscriber_count_view"),
    single("tenant_churn_view"),
    single("tenant_webhook_delivery_view"),
    single("tenant_paywall"),
  ])
  const { data: byPlan } = await supabase
    .from("tenant_revenue_by_plan_view")
    .select("*")
    .eq("tenant_id", tenantId)

  const num = (v: unknown) => Number(v ?? 0)
  const mrrDollars = num(mrr?.mrr_dollars)
  const active = num(subs?.active_count)
  const trial = num(subs?.trial_count)
  const canceled = num(subs?.canceled_count)

  const plans = (byPlan as Record<string, unknown>[] | null) ?? []
  const totalSubs = plans.reduce((a, p) => a + num(p.subscribers), 0)
  const annualSubs = plans.filter((p) => isAnnualSku(p.sku ?? p.plan_id)).reduce((a, p) => a + num(p.subscribers), 0)

  const whTotal = num(webhook?.total)
  const whSuccess = num(webhook?.success)

  const vp = paywall?.value_props
  const valuePropsCount = Array.isArray(vp) ? vp.length : 0

  return {
    mrrDollars,
    active,
    trial,
    canceled,
    arpu: active > 0 ? +(mrrDollars / active).toFixed(2) : 0,
    trialToPaid: active + trial > 0 ? +(active / (active + trial)).toFixed(3) : null,
    churnRate: churn?.churn_rate != null ? num(churn.churn_rate) : null,
    annualShare: totalSubs > 0 ? +(annualSubs / totalSubs).toFixed(3) : null,
    webhookSuccess: whTotal > 0 ? +(whSuccess / whTotal).toFixed(4) : null,
    hasAnnualPlan: plans.some((p) => isAnnualSku(p.sku ?? p.plan_id)),
    popularPlanSku: (paywall?.popular_plan_sku as string) ?? null,
    primaryColor: (paywall?.primary_color as string) ?? null,
    valuePropsCount,
    planCount: plans.length,
  }
}
