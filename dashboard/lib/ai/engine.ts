// PayCraft Brain — deterministic answering engine. No AI/LLM, no external calls.
// match (keyword/synonym scoring) → read tenant metrics → evaluate lever rules → render.

import type { SupabaseClient } from "@supabase/supabase-js"
import { loadMetrics, type Metrics } from "./metrics"
import {
  CONCEPTS,
  DIAGNOSE_INTENTS,
  LEVERS,
  type Intent,
  type Lever,
  type Proposal,
} from "./brain"

export interface Answer {
  text: string
  proposals: Proposal[]
}

const pct = (x: number | null | undefined) => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`)
const usd = (x: number) => `$${x.toLocaleString(undefined, { maximumFractionDigits: 2 })}`

const MATCH_THRESHOLD = 0.6

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim()
}

/** Best phrase match score (0–1) for a question against a keyword set. */
function score(qNorm: string, qTokens: string[], keywords: string[]): number {
  let best = 0
  for (const kw of keywords) {
    const p = norm(kw)
    if (!p) continue
    if (qNorm.includes(p)) {
      best = 1
      break
    }
    const pt = p.split(" ")
    const present = pt.filter((t) => qTokens.includes(t)).length
    best = Math.max(best, present / pt.length)
  }
  return best
}

function metricsLine(m: Metrics): string {
  return `Your numbers: MRR ${usd(m.mrrDollars)} · ARPU ${usd(m.arpu)} · active ${m.active} (trial ${m.trial}, canceled ${m.canceled}) · churn ${pct(m.churnRate)} · trial→paid ${pct(m.trialToPaid)} · annual share ${pct(m.annualShare)} · webhook ${pct(m.webhookSuccess)}.`
}

function leverBlock(l: Lever, m: Metrics): string {
  return `• ${l.title}\n  ${l.why(m)}\n  → ${l.recommendation}`
}

function diagnose(intent: Intent, m: Metrics): Answer {
  const firing = LEVERS.filter((l) => l.trigger(m)).sort((a, b) => a.priority - b.priority)

  if (firing.length === 0) {
    return {
      text: `${metricsLine(m)}\n\nYour billing looks healthy — no high-impact lever is firing right now. Keep watching webhook delivery, trial→paid conversion, and annual-plan share. Ask me again whenever a number moves.`,
      proposals: [],
    }
  }

  if (intent.mode === "automate") {
    const body = firing.map((l) => leverBlock(l, m)).join("\n\n")
    return {
      text: `${metricsLine(m)}\n\nHere's everything worth fixing, highest-impact first:\n\n${body}\n\nReview the proposals below and confirm the ones you want to apply.`,
      proposals: firing.map((l) => l.proposal),
    }
  }

  // Focused modes prefer levers tagged for that focus, then fall back to overall priority.
  let chosen = firing[0]
  if (intent.mode === "churn" || intent.mode === "pricing") {
    const focused = firing.filter((l) => l.focus?.includes(intent.mode as "churn" | "pricing"))
    if (focused.length) chosen = focused[0]
  }

  const others = firing.filter((l) => l.id !== chosen.id)
  const more =
    others.length > 0
      ? `\n\n${others.length} more opportunit${others.length === 1 ? "y" : "ies"} after this — ask "automate everything" to see them all.`
      : ""

  return {
    text: `${metricsLine(m)}\n\nBiggest lever right now:\n\n${leverBlock(chosen, m)}${more}\n\nConfirm the proposal below to apply it.`,
    proposals: [chosen.proposal],
  }
}

const FALLBACK = `I'm your PayCraft Growth Copilot. I answer from PayCraft's knowledge plus your live numbers. Try:
• "How do I increase my MRR?"
• "Why is my revenue flat?"
• "How do I reduce churn?"
• "Is my pricing right?"
• "Automate everything — what should I fix?"
Or ask what something means: MRR, ARPU, churn, dunning, regional pricing, annual plans, coupons, webhooks, the paywall.`

/** Answer a single question deterministically. */
export async function answer(
  question: string,
  supabase: SupabaseClient,
  tenantId: string,
): Promise<Answer> {
  const qNorm = norm(question)
  if (!qNorm) return { text: FALLBACK, proposals: [] }
  const qTokens = qNorm.split(" ")

  // Score diagnose intents and concepts; highest wins.
  let bestIntent: { intent: Intent; s: number } | null = null
  for (const intent of DIAGNOSE_INTENTS) {
    const s = score(qNorm, qTokens, intent.keywords)
    if (!bestIntent || s > bestIntent.s) bestIntent = { intent, s }
  }
  let bestConcept: { id: string; s: number; ans: string } | null = null
  for (const c of CONCEPTS) {
    const s = score(qNorm, qTokens, c.keywords)
    if (!bestConcept || s > bestConcept.s) bestConcept = { id: c.id, s, ans: c.answer }
  }

  const intentS = bestIntent?.s ?? 0
  const conceptS = bestConcept?.s ?? 0

  // Diagnose (actionable) wins ties; needs the live numbers.
  if (intentS >= MATCH_THRESHOLD && intentS >= conceptS) {
    const m = await loadMetrics(supabase, tenantId)
    return diagnose(bestIntent!.intent, m)
  }
  if (conceptS >= MATCH_THRESHOLD) {
    return { text: bestConcept!.ans, proposals: [] }
  }
  return { text: FALLBACK, proposals: [] }
}
