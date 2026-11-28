// Paywall ▸ Experiments — A/B tests of which OFFERING a paywall sells, and (221) which plan it pre-selects.
//
// The database owns the rules — paywall_experiment_save() (migrations 206, 221) — and this mirrors them so the form can
// show an error before a round trip, with the SAME codes and the SAME regexes. Results come from
// paywall_experiment_results(); the first variant is the control every other arm is compared with.

export type ExperimentStatus = "draft" | "running" | "stopped"

/**
 * default_sku (221): the plan this variant's paywall opens on; absent / null / "" = the paywall's own default.
 * (227) exit_offer false = no exit offer for this arm; exit_offer_coupon_id = its own exit-offer coupon;
 * paywall_template = its design. Absent = the tenant's.
 */
export type ExperimentVariant = {
  key: string
  weight: number
  offering_id: string
  default_sku?: string | null
  exit_offer?: boolean | null
  exit_offer_coupon_id?: string | null
  paywall_template?: string | null
}

/** The designs a variant can test (227) — the templates the SDK renders. */
export const PAYWALL_TEMPLATES = [
  { value: "branded-stack", label: "Branded stack" },
  { value: "minimal", label: "Minimal" },
  { value: "premium", label: "Premium" },
  { value: "dark", label: "Dark" },
] as const

export type ExperimentDraft = { key: string; name: string; variants: ExperimentVariant[] }

export type Experiment = ExperimentDraft & {
  status: ExperimentStatus
  started_at: string | null
  stopped_at: string | null
}

/** revenue (227): catalogue price of what each buyer bought, in cents, per currency — {"INR": 79900}. */
export type ResultRow = {
  variant: string
  viewers: number
  checkouts: number
  buyers: number
  conversion: number
  offer_views?: number
  offer_accepts?: number
  revenue?: Record<string, number>
  /** (228) buyers who started on a free trial, and how many of those trials turned paid. */
  trial_starts?: number
  trial_paid?: number
}

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
  "experiment_default_sku_unknown",
  "experiment_exit_offer_invalid",
  "experiment_exit_coupon_unknown",
  "experiment_template_unknown",
  "experiment_variant_unknown",
] as const

/**
 * Null when [d] can be saved; otherwise the database's error code. [offeringIds]: the tenant's ACTIVE offerings.
 * [skusByOffering]: offering id → the active SKUs it sells; without it a default_sku is left to the database.
 */
export function validateExperiment(
  d: ExperimentDraft,
  offeringIds: readonly string[],
  skusByOffering?: Readonly<Record<string, readonly string[]>>,
): string | null {
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
    const sku: unknown = v.default_sku
    if (sku != null && sku !== "" && skusByOffering
        && (typeof sku !== "string" || !(skusByOffering[v.offering_id] ?? []).includes(sku))) {
      return "experiment_default_sku_unknown"
    }
    if (v.exit_offer != null && typeof v.exit_offer !== "boolean") return "experiment_exit_offer_invalid"
    if (v.paywall_template && !PAYWALL_TEMPLATES.some((t) => t.value === v.paywall_template)) {
      return "experiment_template_unknown"
    }
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
    case "experiment_default_sku_unknown": return "A variant's pre-selected plan must be an active plan its offering sells."
    case "experiment_exit_offer_invalid": return "A variant's exit offer is either on or off."
    case "experiment_exit_coupon_unknown": return "A variant's exit-offer coupon must be one of your percent-off coupons."
    case "experiment_template_unknown": return "Pick one of the listed paywall designs."
    case "experiment_variant_unknown": return "That variant isn't part of the experiment."
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

/** How sure the difference is real: 1 − p of the two-sided z-test (0.95 = 95%). Null when an arm has no viewers. */
export function confidence(
  control: Pick<ResultRow, "viewers" | "buyers">,
  variant: Pick<ResultRow, "viewers" | "buyers">,
): number | null {
  const { p } = significance(control, variant)
  return p === null ? null : 1 - p
}

/** The currency most of the experiment's revenue is in (the one the page compares arms by), or null. */
export function mainCurrency(rows: readonly ResultRow[]): string | null {
  const totals = new Map<string, number>()
  for (const r of rows) for (const [c, v] of Object.entries(r.revenue ?? {})) totals.set(c, (totals.get(c) ?? 0) + Number(v))
  return [...totals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
}

/** Revenue per paywall viewer in [currency], in major units (₹7.99 → 7.99). 0 without viewers. */
export function revenuePerViewer(r: ResultRow, currency: string | null): number {
  if (!currency || r.viewers <= 0) return 0
  return Number(r.revenue?.[currency] ?? 0) / 100 / r.viewers
}

/**
 * The arm to make the default: the best conversion among arms whose difference from the control is significant
 * and better; the control itself when none is. Null while nothing has been measured.
 */
export function winner(rows: readonly ResultRow[]): string | null {
  const control = rows[0]
  if (!control || rows.every((r) => r.viewers === 0)) return null
  const better = rows.slice(1)
    .filter((r) => Number(r.conversion) > Number(control.conversion) && significance(control, r).significant)
    .sort((a, b) => Number(b.conversion) - Number(a.conversion))
  return better[0]?.variant ?? control.variant
}

// ── Templates (227) ────────────────────────────────────────────────────────────────────────────────────────────

/** What a template builds from: the app's offerings (current first), plans, percent-off coupons and exit coupon. */
export type TemplateContext = {
  offerings: { id: string; is_current?: boolean; plans?: { sku: string; display_name: string; interval?: string | null }[] }[]
  coupons: { id: string; code: string; percent_off: number }[]
  exitCouponId: string | null
  today: string // YYYY-MM-DD, for the key
}

export type ExperimentTemplate = {
  id: string
  name: string
  /** What it answers, in one line. */
  question: string
  /** Null when the app can run it; otherwise what it needs first. */
  needs: (ctx: TemplateContext) => string | null
  build: (ctx: TemplateContext) => ExperimentDraft
}

const currentOffering = (ctx: TemplateContext) => ctx.offerings.find((o) => o.is_current) ?? ctx.offerings[0]
const planBy = (ctx: TemplateContext, interval: string) =>
  currentOffering(ctx)?.plans?.find((p) => p.interval === interval)?.sku ?? null
const arm = (key: string, offering: string, extra: Partial<ExperimentVariant> = {}): ExperimentVariant =>
  ({ key, weight: 50, offering_id: offering, ...extra })
const draftOf = (id: string, name: string, today: string, variants: ExperimentVariant[]): ExperimentDraft =>
  ({ key: `${id}-${today}`.slice(0, 48), name, variants })

/**
 * Production-ready starting points, the questions subscription apps test first. Every arm keeps the exit offer ON
 * (the tenant's) unless the template is about the exit offer itself. 50/50 so each arm reaches significance soonest.
 */
export const EXPERIMENT_TEMPLATES: ExperimentTemplate[] = [
  {
    id: "exit-offer",
    name: "Exit offer on vs off",
    question: "Does a discount when buyers close the paywall win more paying users than it gives away?",
    needs: (ctx) => (ctx.exitCouponId ? null : "Pick an exit-offer coupon on Paywall ▸ Exit survey first."),
    build: (ctx) => draftOf("exit-offer", "Exit offer on vs off", ctx.today, [
      arm("offer-on", currentOffering(ctx)!.id),
      arm("offer-off", currentOffering(ctx)!.id, { exit_offer: false }),
    ]),
  },
  {
    id: "preselect-annual",
    name: "Pre-selected plan: annual vs monthly",
    question: "Does opening on the annual plan raise revenue per viewer, or scare buyers off?",
    needs: (ctx) => (planBy(ctx, "year") && planBy(ctx, "month") ? null : "Needs a monthly and an annual plan in the current offering."),
    build: (ctx) => draftOf("preselect-annual", "Pre-selected plan: annual vs monthly", ctx.today, [
      arm("monthly-first", currentOffering(ctx)!.id, { default_sku: planBy(ctx, "month") }),
      arm("annual-first", currentOffering(ctx)!.id, { default_sku: planBy(ctx, "year") }),
    ]),
  },
  {
    id: "discount-size",
    name: "Exit discount size",
    question: "Is a smaller exit discount enough — or does a bigger one pay for itself?",
    needs: (ctx) => (ctx.exitCouponId && ctx.coupons.some((c) => c.id !== ctx.exitCouponId)
      ? null : "Needs your exit-offer coupon plus a second percent-off coupon to compare."),
    build: (ctx) => {
      const other = ctx.coupons.find((c) => c.id !== ctx.exitCouponId)!
      return draftOf("discount-size", "Exit discount size", ctx.today, [
        arm("current-discount", currentOffering(ctx)!.id),
        arm(`${other.percent_off}pct`, currentOffering(ctx)!.id, { exit_offer_coupon_id: other.id }),
      ])
    },
  },
  {
    id: "paywall-design",
    name: "Paywall design",
    question: "Does a cleaner paywall convert better than your current one?",
    needs: (ctx) => (ctx.offerings.length ? null : "Needs an offering."),
    build: (ctx) => draftOf("paywall-design", "Paywall design", ctx.today, [
      arm("current-design", currentOffering(ctx)!.id),
      arm("minimal", currentOffering(ctx)!.id, { paywall_template: "minimal" }),
    ]),
  },
  {
    id: "plan-lineup",
    name: "Plan lineup",
    question: "Do fewer (or different) plans make the choice easier?",
    needs: (ctx) => (ctx.offerings.length >= 2 ? null : "Needs a second offering with the other lineup (Products ▸ Offerings)."),
    build: (ctx) => draftOf("plan-lineup", "Plan lineup", ctx.today, [
      arm("current-lineup", currentOffering(ctx)!.id),
      arm("new-lineup", ctx.offerings.find((o) => o.id !== currentOffering(ctx)!.id)!.id),
    ]),
  },
  {
    id: "trial-length",
    name: "Free trial length",
    question: "Does a longer (or no) free trial bring more paying subscribers after the trial ends?",
    needs: (ctx) => (ctx.offerings.length >= 2 ? null : "Needs a second offering whose plans carry the other trial length."),
    build: (ctx) => draftOf("trial-length", "Free trial length", ctx.today, [
      arm("current-trial", currentOffering(ctx)!.id),
      arm("other-trial", ctx.offerings.find((o) => o.id !== currentOffering(ctx)!.id)!.id),
    ]),
  },
]

/** Share of this arm's trials that turned paid (0.4 = 40%); null when nobody started a trial. */
export function trialToPaid(r: Pick<ResultRow, "trial_starts" | "trial_paid">): number | null {
  const starts = Number(r.trial_starts ?? 0)
  return starts > 0 ? Number(r.trial_paid ?? 0) / starts : null
}
