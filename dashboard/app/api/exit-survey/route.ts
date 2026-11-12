export const runtime = "edge"

// Paywall ▸ Exit survey (paycraft-paywall-analytics T15). GET: the tenant's survey, its coupons (with the lanes each
// discount reaches) and how many products a store offer must cover. PUT: save — checked here for a quick 400, then
// by tenant_exit_survey_save (migration 183), which owns the rules and the admin check. Apps pick the change up with
// their next /config (5 min cache).

import { NextRequest, NextResponse } from "next/server"
import { createClient } from "@/lib/supabase-server"
import { requireTenant } from "@/lib/tenant"
import { type SurveyDraft, validateSurvey } from "@/lib/exit-survey-config"

export async function GET() {
  const { tenant } = await requireTenant()
  const supabase = createClient()
  const [survey, coupons, products] = await Promise.all([
    supabase.from("tenant_exit_survey")
      .select("enabled,title,reasons,survey_cap_days,offer_hours,updated_at")
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
    supabase.rpc("tenant_coupons_list", { p_tenant_id: tenant.id }),
    supabase.from("tenant_products").select("id", { count: "exact", head: true }).eq("tenant_id", tenant.id).eq("active", true),
  ])
  if (survey.error) return NextResponse.json({ error: survey.error.message }, { status: 500 })
  if (coupons.error) return NextResponse.json({ error: coupons.error.message }, { status: 500 })
  return NextResponse.json({
    survey: survey.data,
    coupons: (coupons.data ?? []).filter((c: { active: boolean }) => c.active),
    productCount: products.count ?? 0,
  })
}

export async function PUT(req: NextRequest) {
  const { tenant, userId } = await requireTenant()
  const body = (await req.json().catch(() => null)) as SurveyDraft | null
  if (!body) return NextResponse.json({ error: "bad_body" }, { status: 400 })
  const supabase = createClient()

  const { data: coupons } = await supabase.rpc("tenant_coupons_list", { p_tenant_id: tenant.id })
  const problem = validateSurvey(body, (coupons ?? []).map((c: { id: string }) => c.id))
  if (problem) return NextResponse.json({ error: problem }, { status: 400 })

  const { data: saved, error } = await supabase.rpc("tenant_exit_survey_save", {
    p_tenant_id: tenant.id,
    p_enabled: !!body.enabled,
    p_title: body.title,
    p_reasons: body.reasons,
    p_cap_days: body.survey_cap_days,
    p_offer_hours: body.offer_hours,
  })
  if (error) {
    if (error.code === "42501") return NextResponse.json({ error: "forbidden" }, { status: 403 })
    if (error.code === "22023") {
      return NextResponse.json({ error: error.message.replace(/^invalid_exit_survey: /, "") }, { status: 400 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await supabase.rpc("audit_log_emit", {
    p_tenant_id: tenant.id,
    p_actor_user_id: userId,
    p_actor_type: "user",
    p_action: "exit_survey.update",
    p_resource: `tenant_exit_survey:tenant_id=${tenant.id}`,
    p_after: saved,
  })
  return NextResponse.json({ survey: saved })
}
