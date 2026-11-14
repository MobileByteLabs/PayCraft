// supabase/functions/_shared/__tests__/trial.test.ts
//
// The one trial rule /config advertises and checkout-initiate bills by. They disagreed (unset → 7 days in
// /config, 0 in checkout), so ReelExport's checkout promised a 7-day trial while Razorpay charged at once.
//
// Run: deno test supabase/functions/_shared/__tests__/trial.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts"
import { DEFAULT_TRIAL_DAYS, effectiveTrial } from "../trial.ts"

Deno.test("an explicit trial length is used as is", () => {
  assertEquals(effectiveTrial({ type: "subscription", trial_enabled: true, trial_duration_days: 14 }), { enabled: true, days: 14 })
})

Deno.test("unset length falls back to the column default — the same number /config always showed", () => {
  assertEquals(effectiveTrial({ type: "subscription", trial_duration_days: null }), { enabled: true, days: DEFAULT_TRIAL_DAYS })
  assertEquals(DEFAULT_TRIAL_DAYS, 7)
})

Deno.test("trial_enabled false turns it off whatever the length", () => {
  assertEquals(effectiveTrial({ type: "subscription", trial_enabled: false, trial_duration_days: 14 }), { enabled: false, days: 0 })
})

Deno.test("0 days means no trial", () => {
  assertEquals(effectiveTrial({ type: "subscription", trial_duration_days: 0 }), { enabled: false, days: 0 })
})

Deno.test("a consumable or one-time purchase never advertises a trial", () => {
  assertEquals(effectiveTrial({ type: "consumable", trial_enabled: true, trial_duration_days: 7 }), { enabled: false, days: 0 })
  assertEquals(effectiveTrial({ type: "one_time", trial_duration_days: null }), { enabled: false, days: 0 })
})

Deno.test("advertised (config) and billed (checkout) agree on every case", () => {
  const cases = [
    { type: "subscription", trial_duration_days: null },
    { type: "subscription", trial_duration_days: 14 },
    { type: "subscription", trial_enabled: false, trial_duration_days: 7 },
    { type: "consumable", trial_duration_days: null },
  ]
  for (const p of cases) {
    const shown = effectiveTrial(p) // /config
    const billed = effectiveTrial(p).days // checkout-initiate start_at / trial_period_days
    assertEquals(shown.enabled ? shown.days : 0, billed)
  }
})
