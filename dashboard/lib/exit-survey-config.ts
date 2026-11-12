// The exit survey a tenant edits on Paywall ▸ Exit survey (paycraft-paywall-analytics GOAL D6, AC-11).
//
// The database owns the rules — migration 183's exit_survey_problem(), run by tenant_exit_survey_save() whichever
// writer saves — and this mirrors them so the form can show an error before a round trip, with the SAME codes
// (supabase/tests/183_exit_survey_editor_test.sql asserts the database side of the cases in this file's test).
// The rules apply to ENABLED reasons: a reason may stay switched off until its coupon exists.

export type ReasonAction = "offer" | "message" | "none"

export type SurveyReason = {
  code: string
  label: string
  enabled?: boolean
  action: ReasonAction
  message?: string | null
  coupon_id?: string | null
  free_text?: boolean
}

export type SurveyDraft = {
  enabled: boolean
  title: string
  reasons: SurveyReason[]
  survey_cap_days: number
  offer_hours: number
}

/** What a new tenant starts with (migration 181's column default). */
export const DEFAULT_REASONS: SurveyReason[] = [
  { code: "too_expensive", label: "It's too expensive", enabled: true, action: "offer", coupon_id: null },
  { code: "just_looking", label: "I'm just looking", enabled: true, action: "none" },
  {
    code: "payment_method",
    label: "My payment method isn't here",
    enabled: true,
    action: "message",
    message: "You can also pay with UPI, cards and wallets on our website.",
  },
  {
    code: "trust",
    label: "I don't trust it yet",
    enabled: true,
    action: "message",
    message: "Cancel any time. Payments are processed securely by the payment provider.",
  },
  { code: "features", label: "I need more features", enabled: true, action: "none" },
  { code: "other", label: "Something else", enabled: true, action: "none", free_text: true },
]

const CODE = /^[a-z][a-z_]{0,30}$/

/** Null when [s] can be saved; otherwise the database's error code. [couponIds]: this tenant's coupons. */
export function validateSurvey(s: SurveyDraft, couponIds: readonly string[]): string | null {
  if (!s.title?.trim() || s.title.length > 80) return "title_1_to_80_chars"
  if (!Number.isInteger(s.survey_cap_days) || s.survey_cap_days < 1 || s.survey_cap_days > 90) return "cap_days_1_to_90"
  if (!Number.isInteger(s.offer_hours) || s.offer_hours < 1 || s.offer_hours > 720) return "offer_hours_1_to_720"
  if (!Array.isArray(s.reasons) || s.reasons.length < 1 || s.reasons.length > 12) return "reasons_1_to_12"
  const seen = new Set<string>()
  let anyOn = false
  for (const r of s.reasons) {
    const code = r.code ?? ""
    if (!CODE.test(code)) return `bad_code:${code}`
    if (seen.has(code)) return `duplicate_code:${code}`
    seen.add(code)
    if (!r.label?.trim() || r.label.length > 60) return `label_1_to_60_chars:${code}`
    if (!["offer", "message", "none"].includes(r.action ?? "none")) return `bad_action:${code}`
    if (r.enabled === false) continue
    anyOn = true
    if (r.action === "offer") {
      if (!r.coupon_id) return `offer_needs_coupon:${code}`
      if (!couponIds.includes(r.coupon_id)) return `unknown_coupon:${code}`
    }
    if (r.action === "message" && (!r.message?.trim() || r.message.length > 200)) return `message_1_to_200_chars:${code}`
  }
  return anyOn ? null : "at_least_one_reason"
}

/** The sentence the form shows for an error code (from [validateSurvey] or the save RPC). */
export function surveyErrorMessage(code: string, reasons: readonly SurveyReason[]): string {
  const [kind, reasonCode] = code.split(":")
  const label = reasons.find((r) => r.code === reasonCode)?.label ?? reasonCode
  switch (kind) {
    case "title_1_to_80_chars": return "The question needs 1–80 characters."
    case "cap_days_1_to_90": return "Ask again after between 1 and 90 days."
    case "offer_hours_1_to_720": return "An offer lasts between 1 and 720 hours."
    case "reasons_1_to_12": return "Keep between 1 and 12 reasons."
    case "at_least_one_reason": return "Switch at least one reason on — or turn the survey off."
    case "bad_code": return `“${reasonCode}” isn't a valid reason id (lowercase letters and _).`
    case "duplicate_code": return `Two reasons share the id “${reasonCode}”.`
    case "label_1_to_60_chars": return `Each reason needs a label of 1–60 characters (“${reasonCode}”).`
    case "bad_action": return `“${label}” has an unknown action.`
    case "offer_needs_coupon": return `“${label}” gives an offer — pick a coupon, or switch the reason off.`
    case "unknown_coupon": return `“${label}” uses a coupon that no longer exists — pick another.`
    case "message_1_to_200_chars": return `“${label}” shows a message — write one (up to 200 characters).`
    default: return "The survey couldn't be saved."
  }
}

export type CouponLanes = {
  stripe_coupon_id: string | null
  stripe_promotion_code_id: string | null
  razorpay_offer_id: string | null
  googleplay_offer_ids: Record<string, string> | null
  appstore_offer_ids: Record<string, string> | null
}

export type LaneReadiness = { lane: "Stripe" | "Razorpay" | "Google Play" | "App Store"; ready: boolean; note: string | null }

/**
 * On which lanes a coupon's discount can be applied — the same reading as the winback function's lanesFor()
 * (supabase/functions/_shared/winback-offer.ts): Stripe and Razorpay per coupon, the stores per product
 * ([productCount] products need an offer id each).
 */
export function laneReadiness(c: CouponLanes, productCount: number): LaneReadiness[] {
  const store = (ids: Record<string, string> | null, none: string): Pick<LaneReadiness, "ready" | "note"> => {
    const n = Object.values(ids ?? {}).filter(Boolean).length
    if (n === 0) return { ready: false, note: none }
    if (productCount > 0 && n < productCount) return { ready: false, note: `${n} of ${productCount} products` }
    return { ready: true, note: null }
  }
  return [
    { lane: "Stripe", ready: !!(c.stripe_promotion_code_id || c.stripe_coupon_id), note: c.stripe_promotion_code_id || c.stripe_coupon_id ? null : "not synced" },
    { lane: "Razorpay", ready: !!c.razorpay_offer_id, note: c.razorpay_offer_id ? null : "no offer" },
    { lane: "Google Play", ...store(c.googleplay_offer_ids, "no offer id") },
    { lane: "App Store", ...store(c.appstore_offer_ids, "no promotional offer") },
  ]
}
