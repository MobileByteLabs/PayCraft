// supabase/functions/_shared/exit-survey.ts
//
// The exit survey as the SDKs receive it in `/config` (`exit_survey`), built from the tenant's
// `tenant_exit_survey` row (migration 181) and its live coupons. Pure — `config` loads the rows, this shapes
// them — so the shape is unit-tested without a database.
//
// What reaches a device: only ENABLED reasons; an `offer` reason only with a coupon that can actually be
// redeemed now (active, not past redeem_by, under max_redemptions) and only its discount — never the coupon's
// code or id, which would let anyone redeem it without answering. A tenant with the survey off gets
// `{ enabled: false }`, so the SDK shows nothing.

export type SurveyRow = {
  enabled: boolean
  title: string
  reasons: Array<{
    code: string
    label: string
    enabled?: boolean
    action?: string
    message?: string | null
    coupon_id?: string | null
    free_text?: boolean
  }>
  survey_cap_days: number
}

export type CouponRow = {
  id: string
  percent_off: number | null
  duration: string | null
  duration_in_months: number | null
  active: boolean | null
  redeem_by: string | null
  max_redemptions: number | null
  times_redeemed: number | null
}

export type ExitSurveyWire = {
  enabled: boolean
  title?: string
  cap_days?: number
  reasons?: Array<{
    code: string
    label: string
    action: "offer" | "message" | "none"
    message?: string
    free_text?: boolean
    offer?: { percent_off: number; duration: string; duration_in_months?: number }
  }>
}

export function redeemableNow(c: CouponRow, now = Date.now()): boolean {
  if (!c.active || !c.percent_off || c.percent_off <= 0) return false
  if (c.redeem_by && Date.parse(c.redeem_by) <= now) return false
  if (c.max_redemptions != null && (c.times_redeemed ?? 0) >= c.max_redemptions) return false
  return true
}

export function buildExitSurvey(row: SurveyRow | null, coupons: CouponRow[], now = Date.now()): ExitSurveyWire {
  if (!row || !row.enabled) return { enabled: false }
  const byId = new Map(coupons.map((c) => [c.id, c]))
  const reasons = (Array.isArray(row.reasons) ? row.reasons : [])
    .filter((r) => r && r.enabled !== false && typeof r.code === "string" && typeof r.label === "string")
    .map((r) => {
      const action = r.action === "offer" || r.action === "message" ? r.action : "none"
      const out: NonNullable<ExitSurveyWire["reasons"]>[number] = { code: r.code, label: r.label, action }
      if (r.free_text) out.free_text = true
      if (action === "message" && r.message) out.message = r.message
      if (action === "offer") {
        const c = r.coupon_id ? byId.get(r.coupon_id) : undefined
        if (c && redeemableNow(c, now)) {
          out.offer = { percent_off: c.percent_off!, duration: c.duration ?? "once" }
          if (c.duration_in_months != null) out.offer.duration_in_months = c.duration_in_months
        } else {
          out.action = "none" // no live coupon: the reason is still asked, nothing is promised
        }
      }
      return out
    })
  if (reasons.length === 0) return { enabled: false }
  return { enabled: true, title: row.title, cap_days: row.survey_cap_days, reasons }
}
