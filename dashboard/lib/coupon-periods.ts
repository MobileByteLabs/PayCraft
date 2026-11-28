/**
 * How many of a plan's own billing periods a coupon's discount lasts. Both stores count an offer's phase in the
 * subscription's period (Google Play `recurrenceCount`, App Store `numberOfPeriods`), so "3 months" is 3 periods on
 * a monthly plan but 1 on a quarterly one — it used to become 3 periods on every plan (9 months on quarterly, 3 years
 * on annual). Null when the plan can't carry the duration exactly (3 months on a semi-annual or annual plan): the
 * coupon is not offered on that plan rather than over-discounted. "forever" is capped at 12 — store offers are finite.
 */
const FOREVER_CAP = 12
const MONTHS_PER_PERIOD: Record<string, number> = { month: 1, quarter: 3, semiannual: 6, year: 12 }

export function couponPeriodCount(
  duration: "once" | "repeating" | "forever",
  durationInMonths: number | null,
  interval: string | null,
): number | null {
  if (duration === "once") return 1
  if (duration === "forever") return FOREVER_CAP
  const months = durationInMonths ?? 1
  const per = MONTHS_PER_PERIOD[interval ?? "month"] ?? 1
  return months % per === 0 ? months / per : null
}
