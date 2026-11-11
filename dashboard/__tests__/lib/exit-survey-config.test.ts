import { describe, expect, it } from "@jest/globals"
import {
  DEFAULT_REASONS,
  laneReadiness,
  surveyErrorMessage,
  validateSurvey,
  type SurveyDraft,
} from "@/lib/exit-survey-config"

// The editor's checks mirror migration 183's exit_survey_problem() and return the SAME codes for the same inputs
// (supabase/tests/183_exit_survey_editor_test.sql asserts the database side of each case below).
const COUPON = "11111111-1111-1111-1111-111111111111"
const base = (over: Partial<SurveyDraft> = {}): SurveyDraft => ({
  enabled: true,
  title: "Before you go — what stopped you?",
  survey_cap_days: 7,
  offer_hours: 48,
  reasons: [
    { code: "too_expensive", label: "It's too expensive", enabled: true, action: "offer", coupon_id: COUPON },
    { code: "payment_method", label: "No UPI", enabled: true, action: "message", message: "UPI on the website" },
    { code: "other", label: "Something else", enabled: true, action: "none", free_text: true },
  ],
  ...over,
})

describe("validateSurvey", () => {
  it("accepts a complete survey", () => {
    expect(validateSurvey(base(), [COUPON])).toBeNull()
  })

  it("names what is wrong, with the database's codes", () => {
    const r = base().reasons
    expect(validateSurvey(base({ reasons: [{ ...r[0], coupon_id: null }] }), [COUPON])).toBe("offer_needs_coupon:too_expensive")
    expect(validateSurvey(base({ reasons: [{ ...r[0], coupon_id: "someone-elses" }] }), [COUPON])).toBe("unknown_coupon:too_expensive")
    expect(validateSurvey(base({ reasons: [{ ...r[1], message: "  " }] }), [COUPON])).toBe("message_1_to_200_chars:payment_method")
    expect(validateSurvey(base({ reasons: [{ ...r[2], label: " " }] }), [COUPON])).toBe("label_1_to_60_chars:other")
    expect(validateSurvey(base({ reasons: [{ ...r[2], code: "Too-Expensive" }] }), [COUPON])).toBe("bad_code:Too-Expensive")
    expect(validateSurvey(base({ reasons: [r[2], r[2]] }), [COUPON])).toBe("duplicate_code:other")
    expect(validateSurvey(base({ reasons: r.map((x) => ({ ...x, enabled: false })) }), [COUPON])).toBe("at_least_one_reason")
    expect(validateSurvey(base({ survey_cap_days: 0 }), [COUPON])).toBe("cap_days_1_to_90")
    expect(validateSurvey(base({ title: "  " }), [COUPON])).toBe("title_1_to_80_chars")
    expect(validateSurvey(base({ reasons: [] }), [COUPON])).toBe("reasons_1_to_12")
  })

  it("lets a switched-off offer wait for its coupon (the defaults ship that way)", () => {
    expect(validateSurvey(base({ reasons: [{ ...base().reasons[0], enabled: false, coupon_id: null }, base().reasons[2]] }), [])).toBeNull()
    expect(DEFAULT_REASONS.map((r) => r.code)).toEqual(["too_expensive", "just_looking", "payment_method", "trust", "features", "other"])
  })

  it("explains each code in words for the form", () => {
    expect(surveyErrorMessage("offer_needs_coupon:too_expensive", base().reasons)).toBe(
      "“It's too expensive” gives an offer — pick a coupon, or switch the reason off.",
    )
    expect(surveyErrorMessage("cap_days_1_to_90", [])).toMatch(/1 and 90 days/)
  })
})

describe("laneReadiness", () => {
  it("says on which lanes a coupon's discount exists, as the winback function decides", () => {
    const lanes = laneReadiness({
      stripe_coupon_id: "co_1",
      stripe_promotion_code_id: null,
      razorpay_offer_id: null,
      googleplay_offer_ids: { p1: "winback-50" },
      appstore_offer_ids: {},
    }, 2)
    expect(lanes).toEqual([
      { lane: "Stripe", ready: true, note: null },
      { lane: "Razorpay", ready: false, note: "no offer" },
      { lane: "Google Play", ready: false, note: "1 of 2 products" },
      { lane: "App Store", ready: false, note: "no promotional offer" },
    ])
  })
})
