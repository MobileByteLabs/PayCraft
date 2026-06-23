// PayCraft Brain — structured knowledge (machine-readable mirror of
// core/knowledge/PAYCRAFT_GROWTH_BRAIN.md). The deterministic engine answers FROM this.
// No AI/LLM — curated levers, concepts, and intent keyword sets.

import type { Metrics } from "./metrics"

export const HEALTHY = {
  trialToPaid: 0.3,
  churn: 0.05,
  annualShare: 0.2,
  webhook: 0.995,
}

const pct = (x: number | null | undefined) => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`)
const usd = (x: number) => `$${x.toLocaleString(undefined, { maximumFractionDigits: 2 })}`

// ── Proposal shape (confirm-gated; the engine surfaces these, never applies them) ──
export interface Proposal {
  action_id: string
  summary: string
  expected_impact: string
  reversal: string
  risk: "low" | "high"
}

// ── MRR levers (ranked: leaks → expansion → conversion → promotions → price) ──
export interface Lever {
  id: string
  priority: number
  title: string
  trigger: (m: Metrics) => boolean
  why: (m: Metrics) => string
  recommendation: string
  proposal: Proposal
  focus?: ("churn" | "pricing")[] // which focused intents prefer this lever
}

export const LEVERS: Lever[] = [
  {
    id: "redeploy_webhook",
    priority: 1,
    title: "Fix webhook delivery (revenue leak)",
    trigger: (m) => m.webhookSuccess != null && m.webhookSuccess < HEALTHY.webhook,
    why: (m) =>
      `Your webhook success rate is ${pct(m.webhookSuccess)} — below the 99.5% floor. Failed webhooks mean paying customers are never flipped to premium, so you lose MRR silently and get refund requests.`,
    recommendation: "Redeploy the webhook handler and re-verify provider delivery.",
    proposal: {
      action_id: "redeploy_webhook",
      summary: "Redeploy the payment webhook handler",
      expected_impact: "Recovers paid-but-not-activated subscribers — direct MRR + fewer refunds.",
      reversal: "Webhook redeploy is idempotent; the prior version stays available.",
      risk: "low",
    },
    focus: ["churn"],
  },
  {
    id: "add_or_promote_annual_plan",
    priority: 2,
    title: "Add / promote an annual plan",
    trigger: (m) => !m.hasAnnualPlan || (m.annualShare != null && m.annualShare < HEALTHY.annualShare),
    why: (m) =>
      !m.hasAnnualPlan
        ? "You have no annual plan. An annual option pulls 11–12 months of MRR forward and annual subscribers churn far less."
        : `Annual plans are only ${pct(m.annualShare)} of your subscribers (healthy is 25–40%). Promoting annual pulls revenue forward and cuts churn.`,
    recommendation:
      'Add an annual plan (or set the existing one as MOST POPULAR) with "2 months free" framing.',
    proposal: {
      action_id: "add_or_promote_annual_plan",
      summary: "Add an annual plan and set it as MOST POPULAR",
      expected_impact: "Shifts plan mix toward annual — pulls MRR forward and lowers churn.",
      reversal: "Unset MOST POPULAR / archive the annual plan (existing subscribers unaffected).",
      risk: "low",
    },
    focus: ["pricing"],
  },
  {
    id: "adjust_trial",
    priority: 3,
    title: "Tune the free trial (conversion)",
    trigger: (m) => m.trialToPaid != null && m.trialToPaid < HEALTHY.trialToPaid,
    why: (m) =>
      `Your trial→paid conversion is ${pct(m.trialToPaid)} — below the 30% healthy floor. A right-sized trial plus a reminder before it expires lifts conversion.`,
    recommendation: "Right-size the trial length and enable an expiry reminder.",
    proposal: {
      action_id: "adjust_trial",
      summary: "Adjust trial length + enable an expiry reminder",
      expected_impact: "Higher trial→paid conversion at constant traffic.",
      reversal: "Restore the previous trial length / disable the reminder.",
      risk: "low",
    },
    focus: ["churn"],
  },
  {
    id: "tune_paywall_copy",
    priority: 4,
    title: "Polish the paywall (top-of-funnel)",
    trigger: (m) => m.popularPlanSku == null || m.valuePropsCount === 0 || m.primaryColor == null,
    why: (m) => {
      const gaps: string[] = []
      if (m.popularPlanSku == null) gaps.push("no MOST POPULAR plan is set")
      if (m.valuePropsCount === 0) gaps.push("no value props are configured")
      if (m.primaryColor == null) gaps.push("no brand color is set")
      return `Your paywall is missing conversion essentials: ${gaps.join(", ")}. These lift paywall→checkout.`
    },
    recommendation: "Set a MOST POPULAR plan, add value props, and set your brand color.",
    proposal: {
      action_id: "tune_paywall_copy",
      summary: "Set popular plan + value props + brand color",
      expected_impact: "Higher paywall→checkout conversion.",
      reversal: "Clear the fields you set (instantly reversible).",
      risk: "low",
    },
  },
  {
    id: "winback_campaign",
    priority: 5,
    title: "Win back canceled customers (promotion)",
    trigger: (m) => m.canceled >= 5,
    why: (m) =>
      `You have ${m.canceled} canceled subscribers. A time-boxed win-back coupon recovers a share of otherwise-lost revenue.`,
    recommendation: "Run a time-boxed win-back coupon to the canceled cohort.",
    proposal: {
      action_id: "winback_campaign",
      summary: "Time-boxed win-back coupon for canceled customers",
      expected_impact: "Reactivates a share of the canceled cohort.",
      reversal: "Coupon is time-boxed; let it expire or delete it.",
      risk: "low",
    },
  },
  {
    id: "enable_dunning",
    priority: 6,
    title: "Recover failed payments (dunning)",
    trigger: (m) => m.churnRate != null && m.churnRate > 0.07,
    why: (m) =>
      `Your monthly churn is ${pct(m.churnRate)} — above the 5% healthy band. A chunk of that is usually involuntary (failed payments); retries + a card-update nudge recover about half.`,
    recommendation: "Enable dunning: payment retries + a card-update nudge.",
    proposal: {
      action_id: "enable_dunning",
      summary: "Enable dunning (retries + card-update nudge)",
      expected_impact: "Recovers ~half of involuntary (failed-payment) churn.",
      reversal: "Disable dunning in settings.",
      risk: "low",
    },
    focus: ["churn"],
  },
  {
    id: "change_base_price",
    priority: 7,
    title: "Raise base price (ARPU) — last resort",
    trigger: (m) => m.churnRate != null && m.churnRate < 0.03 && m.arpu > 0 && m.arpu < 10,
    why: (m) =>
      `Your ARPU is ${usd(m.arpu)} with low churn (${pct(m.churnRate)}) — that's pricing power. A measured price increase flows straight to MRR, but mistimed it can spike churn.`,
    recommendation:
      "Raise the base price for NEW subscribers only (grandfather existing subs). Test on one plan first.",
    proposal: {
      action_id: "change_base_price",
      summary: "Raise base price for new subscribers (grandfather existing)",
      expected_impact: "Higher ARPU on new subscribers → direct MRR.",
      reversal: "Revert the price; existing subscribers were never changed.",
      risk: "high",
    },
    focus: ["pricing"],
  },
]

// ── Concepts / FAQ (static curated answers) ──
export interface Concept {
  id: string
  keywords: string[]
  answer: string
}

export const CONCEPTS: Concept[] = [
  {
    id: "mrr",
    keywords: ["mrr", "what is mrr", "define mrr", "monthly recurring", "mrr mean", "meaning of mrr"],
    answer:
      "MRR (Monthly Recurring Revenue) is your normalized monthly subscription revenue across all active subscriptions — quarterly/annual plans are converted to a monthly-equivalent. It's the single best number for tracking subscription growth.",
  },
  {
    id: "arpu",
    keywords: ["arpu", "what is arpu", "average revenue", "arpu mean", "revenue per user"],
    answer:
      "ARPU (Average Revenue Per User) = MRR ÷ active subscribers. It tells you how much each paying customer is worth per month. Low ARPU with low churn is a signal you may have pricing power.",
  },
  {
    id: "churn",
    keywords: ["churn", "what is churn", "define churn", "churn mean", "churn rate meaning"],
    answer:
      "Churn is the rate at which subscribers cancel. Monthly churn = cancellations ÷ total in the period. Aim for ≤5%. Some churn is involuntary (failed payments) and is recoverable with dunning.",
  },
  {
    id: "trial_conversion",
    keywords: ["trial", "trials", "trial conversion", "trial to paid", "how do trials work", "free trial"],
    answer:
      "Trial→paid conversion is the share of trial users who become paying subscribers (a healthy floor is ~30%). PayCraft supports a free-trial window per plan plus an expiry reminder to lift conversion.",
  },
  {
    id: "annual",
    keywords: ["annual", "annual plan", "yearly plan", "annual billing", "why annual"],
    answer:
      "An annual plan bills 12 months up front. It pulls revenue forward and annual subscribers churn far less than monthly. Framing it as '2 months free' and marking it MOST POPULAR typically lifts annual share to a healthy 25–40%.",
  },
  {
    id: "regional_pricing",
    keywords: ["regional pricing", "local currency", "ppp", "country pricing", "currency"],
    answer:
      "Regional pricing shows prices in the customer's local currency (and optionally PPP-adjusted amounts). It can lift conversion 20–40% in price-sensitive regions. In PayCraft, configure per-currency prices and ensure each provider has a checkout link in that currency.",
  },
  {
    id: "dunning",
    keywords: ["dunning", "what is dunning", "failed payment", "payment retry", "card update", "involuntary churn"],
    answer:
      "Dunning is automated recovery of failed payments — retrying the charge and nudging the customer to update their card. It recovers roughly half of involuntary churn, which is otherwise silent lost MRR.",
  },
  {
    id: "coupon",
    keywords: ["coupon", "discount", "promo code", "how do i add a coupon"],
    answer:
      "Coupons apply a time-boxed discount (auto-applied or code-driven). Use them for acquisition or to win back canceled customers — keep them time-boxed so they don't become a permanent margin cut. Create them on the Coupons page.",
  },
  {
    id: "webhook",
    keywords: ["webhook", "webhook health", "delivery rate", "payment not activated"],
    answer:
      "Webhooks are how your payment provider tells PayCraft a payment succeeded, which flips the customer to premium. A delivery success rate below 99.5% means some paid users never get activated — a silent MRR leak. Check the Webhooks page.",
  },
  {
    id: "paywall",
    keywords: ["paywall", "most popular", "value props", "hero", "brand color", "paywall design"],
    answer:
      "The paywall is the upgrade screen. Conversion essentials: a MOST POPULAR plan anchor, clear value props, on-brand color/hero, and per-region pricing. Configure all of these on the Paywall page; they're instantly reversible.",
  },
]

// ── Intents (keyword/synonym sets → mode) ──
export interface Intent {
  id: string
  mode: "rank" | "automate" | "churn" | "pricing"
  keywords: string[]
}

export const DIAGNOSE_INTENTS: Intent[] = [
  {
    id: "increase_mrr",
    mode: "rank",
    keywords: ["increase mrr", "grow mrr", "grow revenue", "increase revenue", "boost mrr", "more revenue", "make more money", "grow"],
  },
  {
    id: "why_flat",
    mode: "rank",
    keywords: ["why flat", "revenue flat", "revenue stuck", "not growing", "revenue dropping", "revenue down", "declining", "stalled"],
  },
  {
    id: "reduce_churn",
    mode: "churn",
    keywords: ["reduce churn", "lower churn", "stop churn", "retention", "losing customers", "people leaving", "cancellations"],
  },
  {
    id: "pricing",
    mode: "pricing",
    keywords: ["pricing", "price right", "am i charging", "too cheap", "too expensive", "raise price", "pricing strategy", "what to charge"],
  },
  {
    id: "automate",
    mode: "automate",
    keywords: ["automate everything", "audit", "fix everything", "optimize everything", "full check", "what should i fix", "diagnose"],
  },
]
