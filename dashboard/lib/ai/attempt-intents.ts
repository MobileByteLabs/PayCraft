// Attempt-level questions for the PayCraft Brain (paycraft-attempt-observability GOAL D13 / AC-17).
//
// Deterministic, like the rest of the Brain: a question is MATCHED (keywords + a provider / country / window
// parse), the facts are READ through the shared `paycraft_*` MCP tools (lib/ai/tools-bridge.ts), and the reply is
// RENDERED from those facts. No LLM runs on this path; the Brain only decides which tool to read and how to say it.
//
//   explain   "explain attempt 1732492800000-9f3c2a1b"           → paycraft_attempt
//   health    "why did Stripe payments fail in India yesterday?"  → paycraft_payment_health (once)

import { eventLabel, failingEvent, STAGE_LABEL, type AttemptRow, type AttemptStage } from "@/lib/attempts"
import type { PaymentHealth, HealthBucket } from "@/lib/payment-health"
import { readAttempt, readPaymentHealth, type ToolReader } from "./tools-bridge"

export type Mode = "live" | "test"

export type AttemptIntent =
  | { kind: "explain"; id: string }
  | { kind: "health"; provider: string | null; country: string | null; since: string; until: string; label: string }

const DAY_MS = 86_400_000

/** Provider ids as payment_attempts stores them, with the words an owner uses for each. */
const PROVIDERS: ReadonlyArray<[id: string, phrases: string[]]> = [
  ["stripe", ["stripe"]],
  ["razorpay", ["razorpay", "razor pay"]],
  ["google_play", ["google play", "play store", "play billing", "google_play"]],
  ["app_store", ["app store", "apple", "app_store", "storekit", "in app purchase ios"]],
  ["paddle", ["paddle"]],
  ["lemonsqueezy", ["lemonsqueezy", "lemon squeezy"]],
  ["paypal", ["paypal", "pay pal"]],
  ["paystack", ["paystack"]],
  ["flutterwave", ["flutterwave"]],
  ["cashfree", ["cashfree", "cash free"]],
  ["midtrans", ["midtrans"]],
  ["btcpay", ["btcpay", "btc pay", "bitcoin"]],
]

const FAILURE_WORDS = new Set([
  "fail", "fails", "failed", "failing", "failure", "failures", "decline", "declined", "declines",
  "abandon", "abandons", "abandoned", "abandonment", "drop", "dropped", "dropping",
])
const FAILURE_PHRASES = ["not granted", "payment health", "checkout", "didn t go through", "did not go through"]
const PAYMENT_WORDS = new Set(["payment", "payments", "purchase", "purchases", "attempt", "attempts", "checkout", "checkouts", "pay", "paid"])
/** A definition question is the Brain's concept answer ("what is a failed payment"), not a data question. */
const DEFINITION = /^(what is|what are|what s|what does|define|meaning of|explain what)\b/
const ADVICE = /^how (do|to|can|should|would|could)\b/

/** Country names (en) → ISO alpha-2, built once from the runtime's own region data plus everyday aliases. */
const COUNTRY_NAMES: Map<string, string> = (() => {
  const names = new Map<string, string>()
  const display = new Intl.DisplayNames(["en"], { type: "region" })
  for (let a = 65; a <= 90; a++) {
    for (let b = 65; b <= 90; b++) {
      const code = String.fromCharCode(a, b)
      let name: string | undefined
      try {
        name = display.of(code)
      } catch {
        name = undefined
      }
      if (name && name !== code && name !== "Unknown Region") names.set(norm(name), code)
    }
  }
  for (const [alias, code] of [
    ["usa", "US"], ["america", "US"], ["united states of america", "US"], ["uk", "GB"], ["britain", "GB"],
    ["great britain", "GB"], ["england", "GB"], ["uae", "AE"], ["emirates", "AE"], ["korea", "KR"],
    ["south korea", "KR"], ["russia", "RU"], ["vietnam", "VN"], ["czech republic", "CZ"], ["holland", "NL"],
  ] as const) names.set(alias, code)
  return names
})()

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9\s_]/g, " ").replace(/\s+/g, " ").trim()
}

const hasPhrase = (q: string, phrase: string) => ` ${q} `.includes(` ${phrase} `)

function matchProvider(q: string): string | null {
  for (const [id, phrases] of PROVIDERS) if (phrases.some((p) => hasPhrase(q, p))) return id
  return null
}

function matchCountry(q: string, original: string): string | null {
  // Longest name first, so "united states" wins over a shorter name inside it.
  const byLength = [...COUNTRY_NAMES.keys()].sort((a, b) => b.length - a.length)
  for (const name of byLength) if (hasPhrase(q, name)) return COUNTRY_NAMES.get(name)!
  // An ISO code typed in capitals ("IN", "US") — lower-case "in" / "us" are ordinary words.
  for (const token of original.match(/\b[A-Z]{2}\b/g) ?? []) {
    if ([...COUNTRY_NAMES.values()].includes(token)) return token
  }
  return null
}

const startOfUtcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))

/** The window a question names; the last 7 days when it names none. */
export function matchWindow(q: string, now: Date): { since: string; until: string; label: string } {
  const today = startOfUtcDay(now)
  const iso = (d: Date) => d.toISOString()
  if (hasPhrase(q, "yesterday")) {
    return { since: iso(new Date(today.getTime() - DAY_MS)), until: iso(today), label: "yesterday (UTC)" }
  }
  if (hasPhrase(q, "today")) return { since: iso(today), until: iso(now), label: "today (UTC)" }
  const days = q.match(/\b(?:last|past|previous)\s+(\d{1,3})\s+days?\b/)
  if (days) {
    const n = Math.max(1, Math.min(365, Number(days[1])))
    return { since: iso(new Date(now.getTime() - n * DAY_MS)), until: iso(now), label: `the last ${n} days` }
  }
  if (/\b(?:last|past)\s+24\s+hours?\b/.test(q)) {
    return { since: iso(new Date(now.getTime() - DAY_MS)), until: iso(now), label: "the last 24 hours" }
  }
  if (/\b(?:last|past|previous|this)\s+month\b/.test(q)) {
    return { since: iso(new Date(now.getTime() - 30 * DAY_MS)), until: iso(now), label: "the last 30 days" }
  }
  return { since: iso(new Date(now.getTime() - 7 * DAY_MS)), until: iso(now), label: "the last 7 days" }
}

/** The attempt intent a question carries, or null when it is not about attempts (the Brain answers it). */
export function matchAttemptIntent(question: string, now: Date): AttemptIntent | null {
  const explain = question.match(/\battempt\s+(?:id\s+)?([A-Za-z0-9][A-Za-z0-9_.:-]{3,159})/i)
  // An attempt id always carries a digit (a UUID or the SDK's `<ms>-<hex>`); "attempt failed" is a sentence.
  if (explain && /\d/.test(explain[1])) return { kind: "explain", id: explain[1] }

  const q = norm(question)
  if (!q || DEFINITION.test(q)) return null
  const tokens = q.split(" ")
  const failure = tokens.some((t) => FAILURE_WORDS.has(t)) || FAILURE_PHRASES.some((p) => hasPhrase(q, p))
  if (!failure) return null
  const provider = matchProvider(q)
  const country = matchCountry(q, question)
  // "How do I reduce failed payments?" asks for advice (the Brain's dunning lever), not for last week's numbers —
  // unless it pins the data down to a provider or a country.
  if (ADVICE.test(q) && !provider && !country) return null
  // "Why did revenue drop" is the Brain's lever question; a drop is an attempt question only once it names
  // payments, a provider or a country.
  if (!provider && !country && !tokens.some((t) => PAYMENT_WORDS.has(t)) && !hasPhrase(q, "not granted")) return null
  return { kind: "health", provider, country, ...matchWindow(q, now) }
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`

const PROVIDER_LABEL: Record<string, string> = {
  stripe: "Stripe", razorpay: "Razorpay", google_play: "Google Play", app_store: "the App Store", paddle: "Paddle",
  lemonsqueezy: "Lemon Squeezy", paypal: "PayPal", paystack: "Paystack", flutterwave: "Flutterwave",
  cashfree: "Cashfree", midtrans: "Midtrans", btcpay: "BTCPay",
}
const providerLabel = (id: string) => PROVIDER_LABEL[id] ?? id
const countryLabel = (code: string) => {
  try {
    return `${new Intl.DisplayNames(["en"], { type: "region" }).of(code) ?? code} (${code})`
  } catch {
    return code
  }
}

function bucketLine(label: string, b: HealthBucket | undefined, emptyLabel: string): string {
  return b ? `${label}: ${b.failed} of ${b.total} attempts failed (${pct(b.rate)}).` : `${label}: ${emptyLabel}.`
}

type HealthBody = PaymentHealth & { window?: { since: string; until: string; capped: boolean; retention_days: number } }

export function renderHealth(intent: Extract<AttemptIntent, { kind: "health" }>, mode: Mode, h: HealthBody): string {
  const t = h.totals
  if (t.attempts === 0) {
    return `No purchase attempts ${intent.label} in ${mode} mode, so nothing failed — and nothing was bought through PayCraft either. If you expected traffic, check that the app is on an SDK version that reports attempts.`
  }
  const lines: string[] = [
    `Payment health, ${intent.label} (${mode} mode): ${t.attempts} attempts — ${t.granted} granted (${pct(t.grantRate)}), ${t.failed} failed, ${t.paidNotGranted} paid but not granted, ${t.abandoned} abandoned, ${t.open} still open.`,
  ]
  if (intent.provider) {
    lines.push(bucketLine(providerLabel(intent.provider), h.byProvider.find((b) => b.key === intent.provider), `no attempts ${intent.label}`))
  } else {
    const worst = [...h.byProvider].filter((b) => b.failed > 0).sort((a, b) => b.rate - a.rate || b.failed - a.failed)[0]
    if (worst) lines.push(`Highest failure rate by provider: ${providerLabel(worst.key)}, ${worst.failed} of ${worst.total} (${pct(worst.rate)}).`)
  }
  if (intent.country) {
    lines.push(bucketLine(countryLabel(intent.country), h.byCountry.find((b) => b.key === intent.country), `no attempts ${intent.label}`))
  } else {
    const worst = [...h.byCountry].filter((b) => b.failed > 0 && b.key !== "unknown").sort((a, b) => b.rate - a.rate || b.failed - a.failed)[0]
    if (worst) lines.push(`Highest failure rate by country: ${countryLabel(worst.key)}, ${worst.failed} of ${worst.total} (${pct(worst.rate)}).`)
  }
  if (h.byStage.length) {
    const stages = h.byStage.slice(0, 3).map((s) => `${STAGE_LABEL[s.key as AttemptStage] ?? s.key} ${s.failed}`).join(" · ")
    lines.push(`Where failures ended: ${stages}.`)
  }
  const abandon = [...h.abandonByStep].filter((s) => s.abandoned > 0).sort((a, b) => b.rate - a.rate)[0]
  if (abandon) lines.push(`Biggest give-up point: ${abandon.step.replace(/_/g, " ")} — ${abandon.abandoned} of ${abandon.reached} (${pct(abandon.rate)}) left there.`)
  if (h.paidNotGranted > 0) {
    lines.push(`${h.paidNotGranted} buyer${h.paidNotGranted === 1 ? " was" : "s were"} charged without getting access — reach them first (Alerts inbox, kind paid_not_granted).`)
  }
  if (h.nudge.reach !== null) lines.push(`Resume reminders reached ${pct(h.nudge.reach)} of eligible buyers.`)
  if (h.window?.capped) lines.push(`Your plan keeps ${h.window.retention_days} days of attempt data, so the window was shortened to that.`)
  const filters = [
    "state=failed",
    intent.provider ? `provider=${intent.provider}` : null,
    intent.country ? `country=${intent.country}` : null,
    `since=${intent.since.slice(0, 10)}`,
    `until=${intent.until.slice(0, 10)}`,
  ].filter(Boolean).join(" ")
  lines.push(`For each failure's code, ask over MCP: paycraft_attempts ${filters} — then paycraft_attempt id=<one of them> for its timeline.`)
  return lines.join("\n")
}

const hhmm = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`

export function renderAttempt(a: AttemptRow & { country?: string | null }): string {
  const state = eventLabel(a.state)
  const lines = [
    `Attempt ${a.attempt_id ?? a.id} — ${providerLabel(a.provider)}, ${a.plan ?? "no plan recorded"}, ${a.mode} mode${a.country ? `, ${countryLabel(a.country)}` : ""}: ${state}.`,
    a.correlation === "inferred"
      ? `Matched to this attempt by the provider's own key (rule ${a.match_rule ?? "unknown"}), not named by the SDK.`
      : `Named by the SDK end to end (exact correlation).`,
  ]
  const failing = failingEvent(a)
  if (failing) {
    const what = [failing.error_class, failing.error_code].filter(Boolean).join(" / ")
    lines.push(`It failed at the ${STAGE_LABEL[failing.stage]} stage${what ? ` — ${what}` : ""}${failing.error_message ? `: ${failing.error_message}` : "."}`)
  } else if (a.state === "abandoned") {
    lines.push("Nothing failed: the buyer left before paying.")
  }
  if (a.events.length) {
    lines.push("Timeline:")
    for (const e of a.events) {
      const err = e.error_code ? ` (${e.error_code})` : ""
      lines.push(`• ${hhmm(e.occurred_at)} — ${eventLabel(e.event)} [${STAGE_LABEL[e.stage]}]${err}`)
    }
  } else {
    lines.push("No timeline rows were recorded for it (attempts written before the SDK reported steps carry only their final state).")
  }
  return lines.join("\n")
}

const refusal = (what: string, r: { status: number; body: unknown }) => {
  const code = (r.body as { error?: string } | null)?.error ?? `HTTP ${r.status}`
  return `I couldn't read ${what} right now (${code}). Nothing was changed — try again in a moment.`
}

/** Answer an attempt intent from the shared tools. Reader-only: never proposes a change. */
export async function answerAttemptIntent(intent: AttemptIntent, read: ToolReader, mode: Mode): Promise<string> {
  if (intent.kind === "explain") {
    const r = await readAttempt(read, intent.id)
    if (r.status === 404) return `I can't find attempt ${intent.id} in this app. Attempt ids come from the subscriber timeline or from paycraft_attempts.`
    if (!r.ok) return refusal(`attempt ${intent.id}`, r)
    return renderAttempt(r.body as AttemptRow)
  }
  const r = await readPaymentHealth(read, { since: intent.since, until: intent.until, mode })
  if (!r.ok) return refusal("payment health", r)
  return renderHealth(intent, mode, r.body as HealthBody)
}
