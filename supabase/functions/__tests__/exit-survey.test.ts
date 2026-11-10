// The exit survey `/config` serves (paycraft-paywall-analytics AC-11): enabled reasons only, an offer only with a
// coupon that can be redeemed now, and never the coupon's code or id on the wire.
// Run: deno test --no-check supabase/functions/__tests__/exit-survey.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { buildExitSurvey, type CouponRow, type SurveyRow } from "../_shared/exit-survey.ts"

const row = (over: Partial<SurveyRow> = {}): SurveyRow => ({
  enabled: true,
  title: "Before you go — what stopped you?",
  survey_cap_days: 7,
  reasons: [
    { code: "too_expensive", label: "It's too expensive", enabled: true, action: "offer", coupon_id: "c1" },
    { code: "just_looking", label: "I'm just looking", enabled: true, action: "none" },
    { code: "payment_method", label: "No UPI", enabled: true, action: "message", message: "UPI on the website." },
    { code: "trust", label: "Not sure", enabled: false, action: "none" },
    { code: "other", label: "Something else", enabled: true, action: "none", free_text: true },
  ],
  ...over,
})
const coupon = (over: Partial<CouponRow> = {}): CouponRow => ({
  id: "c1", percent_off: 50, duration: "once", duration_in_months: null, active: true,
  redeem_by: null, max_redemptions: null, times_redeemed: 0, ...over,
})

Deno.test("serves enabled reasons, the offer's discount, messages and the free-text flag", () => {
  const s = buildExitSurvey(row(), [coupon()])
  assertEquals(s.enabled, true)
  assertEquals(s.cap_days, 7)
  assertEquals(s.reasons!.map((r) => r.code), ["too_expensive", "just_looking", "payment_method", "other"])
  assertEquals(s.reasons![0], { code: "too_expensive", label: "It's too expensive", action: "offer", offer: { percent_off: 50, duration: "once" } })
  assertEquals(s.reasons![2].message, "UPI on the website.")
  assertEquals(s.reasons![3].free_text, true)
  assertEquals(JSON.stringify(s).includes("c1"), false, "the coupon id never reaches a device")
})

Deno.test("an offer without a redeemable coupon is asked but promises nothing", () => {
  for (const c of [coupon({ active: false }), coupon({ redeem_by: "2000-01-01T00:00:00Z" }), coupon({ max_redemptions: 5, times_redeemed: 5 })]) {
    const s = buildExitSurvey(row(), [c])
    assertEquals(s.reasons![0].action, "none")
    assertEquals(s.reasons![0].offer, undefined)
  }
  assertEquals(buildExitSurvey(row(), []).reasons![0].action, "none")
})

Deno.test("off, missing or empty → enabled false", () => {
  assertEquals(buildExitSurvey(row({ enabled: false }), []), { enabled: false })
  assertEquals(buildExitSurvey(null, []), { enabled: false })
  assertEquals(buildExitSurvey(row({ reasons: [{ code: "x", label: "X", enabled: false }] }), []), { enabled: false })
})
