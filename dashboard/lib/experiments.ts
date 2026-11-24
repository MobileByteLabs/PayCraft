// Paywall ▸ Experiments — A/B tests of which OFFERING a paywall sells.
//
// The database owns the rules — migration 206's paywall_experiment_save() — and this mirrors them so the form can
// show an error before a round trip, with the SAME codes and the SAME regexes. Results come from
// paywall_experiment_results(); the first variant is the control every other arm is compared with.

export type ExperimentStatus = "draft" | "running" | "stopped"

export type ExperimentVariant = { key: string; weight: number; offering_id: string }

export type ExperimentDraft = { key: string; name: string; variants: ExperimentVariant[] }

export type Experiment = ExperimentDraft & {
  status: ExperimentStatus
  started_at: string | null
  stopped_at: string | null
}

export type ResultRow = { variant: string; viewers: number; checkouts: number; buyers: number; conversion: number }

export const EXPERIMENT_KEY = /^[a-z0-9][a-z0-9-]{1,47}$/
export const VARIANT_KEY = /^[a-z0-9][a-z0-9-]{0,31}$/

/** Every code paywall_experiment_save / paywall_experiment_set_status raise. */
export const EXPERIMENT_ERROR_CODES = [
  "experiment_key_invalid",
  "experiment_variants_count",
  "experiment_variant_key_invalid",
  "experiment_variant_key_duplicate",
  "experiment_weight_invalid",
  "experiment_offering_unknown",
  "experiment_not_editable",
  "experiment_not_found",
  "experiment_bad_transition",
  "experiment_already_running",
  "experiment_offering_empty",
] as const

/** Null when [d] can be saved; otherwise the database's error code. [offeringIds]: the tenant's ACTIVE offerings. */
export function validateExperiment(d: ExperimentDraft, offeringIds: readonly string[]): string | null {
  if (typeof d.key !== "string" || !EXPERIMENT_KEY.test(d.key)) return "experiment_key_invalid"
  if (!Array.isArray(d.variants) || d.variants.length < 2 || d.variants.length > 4) return "experiment_variants_count"
  const seen = new Set<string>()
  for (const v of d.variants) {
    const key = typeof v?.key === "string" ? v.key : ""
    if (!VARIANT_KEY.test(key)) return "experiment_variant_key_invalid"
    if (seen.has(key)) return "experiment_variant_key_duplicate"
    seen.add(key)
    if (typeof v.weight !== "number" || !Number.isInteger(v.weight) || v.weight < 1 || v.weight > 100) {
      return "experiment_weight_invalid"
    }
    if (!offeringIds.includes(v.offering_id)) return "experiment_offering_unknown"
  }
  return null
}

/** The sentence the page shows for an error code (from [validateExperiment] or the RPCs). */
export function experimentErrorMessage(code: string): string {
  switch (code) {
    case "experiment_key_invalid": return "The key needs 2–48 characters: lowercase letters, digits and -, starting with a letter or digit."
    case "experiment_variants_count": return "An experiment has 2 to 4 variants."
    case "experiment_variant_key_invalid": return "Each variant key needs 1–32 characters: lowercase letters, digits and -."
    case "experiment_variant_key_duplicate": return "Two variants share a key."
    case "experiment_weight_invalid": return "Each weight is a whole number from 1 to 100."
    case "experiment_offering_unknown": return "Pick an active offering for every variant."
    case "experiment_not_editable": return "Only a draft can be edited."
    case "experiment_not_found": return "That experiment no longer exists."
    case "experiment_bad_transition": return "An experiment goes draft → running → stopped, once."
    case "experiment_already_running": return "Another experiment is running — stop it first."
    case "experiment_offering_empty": return "Every variant's offering needs at least one product before the experiment can start."
    default: return "The experiment couldn't be saved."
  }
}

/** Relative conversion change of [variant] vs [control] (0.1 = +10%). Null when control converted nobody. */
export function uplift(control: number, variant: number): number | null {
  return control > 0 ? (variant - control) / control : null
}

/** Standard normal CDF (Abramowitz–Stegun 7.1.26, |error| < 1.5e-7). */
function normalCdf(z: number): number {
  const x = Math.abs(z) / Math.SQRT2
  const t = 1 / (1 + 0.3275911 * x)
  const erf = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x)
  return z >= 0 ? (1 + erf) / 2 : (1 - erf) / 2
}

export const MIN_VIEWERS = 100

/**
 * Two-proportion z-test on buyers/viewers of [variant] vs [control]: the two-sided p-value, and `significant`
 * when p < 0.05 and each arm has at least [MIN_VIEWERS] viewers. p is null when an arm has no viewers.
 */
export function significance(
  control: Pick<ResultRow, "viewers" | "buyers">,
  variant: Pick<ResultRow, "viewers" | "buyers">,
): { p: number | null; significant: boolean } {
  const n1 = control.viewers, n2 = variant.viewers
  if (n1 <= 0 || n2 <= 0) return { p: null, significant: false }
  const p1 = control.buyers / n1, p2 = variant.buyers / n2
  const pooled = (control.buyers + variant.buyers) / (n1 + n2)
  const se = Math.sqrt(pooled * (1 - pooled) * (1 / n1 + 1 / n2))
  const p = se === 0 ? 1 : 2 * (1 - normalCdf(Math.abs(p2 - p1) / se))
  return { p, significant: p < 0.05 && n1 >= MIN_VIEWERS && n2 >= MIN_VIEWERS }
}
