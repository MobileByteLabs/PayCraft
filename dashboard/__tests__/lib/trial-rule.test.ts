// The dashboard twin of supabase/functions/_shared/trial.ts. Play sync + readiness must read a product's
// trial exactly as /config and checkout-initiate do, or the web sells a trial the app store does not.
import { effectiveTrialDays } from "@/lib/trial-rule"
import { resolvePlatformTrialDays } from "@/lib/stripe-route-helper"

test("unset length on an enabled subscription is 7 days, as the web serves it", () => {
  expect(effectiveTrialDays({ type: "subscription", trial_enabled: true, trial_duration_days: null })).toBe(7)
})
test("explicit length wins; 0 and disabled mean none; one-time products never have a trial", () => {
  expect(effectiveTrialDays({ type: "subscription", trial_enabled: true, trial_duration_days: 14 })).toBe(14)
  expect(effectiveTrialDays({ type: "subscription", trial_enabled: true, trial_duration_days: 0 })).toBe(0)
  expect(effectiveTrialDays({ type: "subscription", trial_enabled: false, trial_duration_days: 7 })).toBe(0)
  expect(effectiveTrialDays({ type: "one_time", trial_enabled: true, trial_duration_days: null })).toBe(0)
})
test("Play sync gets the same 7 days the web gets (Status Saver pro-annual, 2026-11-23)", () => {
  const body = { type: "subscription", trial_enabled: true, trial_duration_days: null, trial_per_platform: null }
  expect(resolvePlatformTrialDays(body, "android")).toBe(7)
  expect(resolvePlatformTrialDays(body, "web")).toBe(7)
})
test("a per-platform map still overrides — an absent platform means no trial there", () => {
  const body = { type: "subscription", trial_enabled: true, trial_duration_days: null, trial_per_platform: { web: 7 } }
  expect(resolvePlatformTrialDays(body, "android")).toBe(0)
})
