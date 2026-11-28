/**
 * `couponPeriodCount` — both stores count a discount offer's phase in the BASE PLAN's own billing period. "50% off for
 * 3 months" used to become 3 periods on every plan: 9 months on quarterly, 3 years on annual.
 */
import { couponPeriodCount as playRecurrenceCount } from "@/lib/coupon-periods"

describe("playRecurrenceCount", () => {
  it("3 months is 3 monthly periods but 1 quarterly period", () => {
    expect(playRecurrenceCount("repeating", 3, "month")).toBe(3)
    expect(playRecurrenceCount("repeating", 3, "quarter")).toBe(1)
  })
  it("refuses a plan that can't carry the duration exactly", () => {
    expect(playRecurrenceCount("repeating", 3, "semiannual")).toBeNull()
    expect(playRecurrenceCount("repeating", 3, "year")).toBeNull()
    expect(playRecurrenceCount("repeating", 4, "quarter")).toBeNull()
  })
  it("whole multiples work on longer plans", () => {
    expect(playRecurrenceCount("repeating", 12, "year")).toBe(1)
    expect(playRecurrenceCount("repeating", 6, "semiannual")).toBe(1)
    expect(playRecurrenceCount("repeating", 6, "quarter")).toBe(2)
  })
  it("once is the first period; forever is capped at 12", () => {
    expect(playRecurrenceCount("once", null, "year")).toBe(1)
    expect(playRecurrenceCount("forever", null, "month")).toBe(12)
  })
  it("an unknown or missing interval is treated as monthly", () => {
    expect(playRecurrenceCount("repeating", 3, null)).toBe(3)
  })
})
