// The ONE trial rule. `/config` (what the paywall and checkout ADVERTISE) and `checkout-initiate` (what
// the provider is actually told) must agree, or a buyer is promised a free trial and charged on day one.
// They disagreed: `/config` read an unset `trial_duration_days` as 7 days (the column default from
// migration 050) while checkout-initiate read it as 0 — measured on ReelExport, whose web checkout said
// "7-day free trial" while Razorpay asked for ₹299 at once.
//
// Rules, in order:
//   • only subscriptions have trials — a consumable or one-time purchase never advertises one
//   • trial_enabled === false turns it off
//   • an explicit trial_duration_days (> 0) is used as is; 0 means none
//   • unset → 7 days, the column default every existing tenant has been shown
export const DEFAULT_TRIAL_DAYS = 7;

export interface TrialFields {
  type?: unknown;
  trial_enabled?: unknown;
  trial_duration_days?: unknown;
}

export function effectiveTrial(p: TrialFields): { enabled: boolean; days: number } {
  if (p.type != null && p.type !== "subscription") return { enabled: false, days: 0 };
  if (p.trial_enabled === false) return { enabled: false, days: 0 };
  const days = typeof p.trial_duration_days === "number" ? p.trial_duration_days : DEFAULT_TRIAL_DAYS;
  return days > 0 ? { enabled: true, days } : { enabled: false, days: 0 };
}
