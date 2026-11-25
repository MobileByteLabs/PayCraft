// supabase/functions/_shared/payment-attempts.ts
//
// The ONE door into the purchase-attempt record (migration 210, paycraft-attempt-observability D1 / D3 /
// D5 / D6 / D7). Every function that opens, moves or closes an attempt — checkout-initiate, the web PSP
// webhooks, google-rtdn, the App Store notification handler, the two register-* grant endpoints,
// reconcileEntitlement() and the events ingest — goes through these helpers, never through a raw
// `from("checkout_attempts")` write. The legacy 186 / 188 / 201 writers (recordAttempt,
// record_store_attempt) are untouched; the table's own trigger closes their rows.
//
// WHAT LIVES WHERE
//   · The state machine is enforced by the database (attempt_transition_guard). canTransition() mirrors
//     its edge table so callers can reason about it; a refused edge comes back as `false`, never a throw —
//     a webhook redelivery or a late event is normal traffic, not an error.
//   · Every state an attempt enters reaches `attempt_events` through the table's trigger. These helpers
//     append only what the trigger cannot know: breadcrumbs, and failures on an attempt that can no
//     longer move (so a failure is never lost).
//   · Resolvers read the attempt id back from what each provider echoes: Stripe `metadata.attempt_id` /
//     `client_reference_id`, Razorpay `notes.attempt_id`, Cashfree `order_tags.paycraft_attempt_id`, Play
//     `obfuscatedExternalProfileId` (obfuscatedAccountId stays the USER), and for the App Store — whose
//     appAccountToken is already the user — the original_transaction_id → attempt_id map register-appstore
//     writes.
//   · No PII leaves here (D6 / D15): messages are stripped of emails and credentials and capped at 200
//     characters; codes and classes are short slugs.

// deno-lint-ignore no-explicit-any
type Any = any

export type AttemptStage = "sdk" | "server" | "provider" | "webhook" | "entitlement"
export type AttemptState =
  | "started"
  | "checkout_opened"
  | "provider_result"
  | "granted"
  | "failed"
  | "abandoned"
  | "paid_not_granted"

export const ATTEMPT_STAGES: readonly AttemptStage[] = ["sdk", "server", "provider", "webhook", "entitlement"]
export const ATTEMPT_STATES: readonly AttemptState[] = [
  "started",
  "checkout_opened",
  "provider_result",
  "granted",
  "failed",
  "abandoned",
  "paid_not_granted",
]

/** A failure, grouped the way humans and the weekly AI read it (D6). */
export interface AttemptFailure {
  stage: AttemptStage
  error_class: string
  error_code?: string | number | null
  error_message?: string | null
}

export interface OpenAttemptInput {
  attempt_id: string
  tenant_id: string
  provider: string
  mode: "live" | "test"
  app_user_id?: string | null
  email?: string | null
  plan?: string | null
  /** The provider-side key of this attempt. Defaults to the attempt id until a provider object exists. */
  provider_session_id?: string | null
  /** 'started' (default) or 'checkout_opened' when the caller already holds the provider's object. */
  state?: "started" | "checkout_opened"
}

// ── Pure helpers ────────────────────────────────────────────────────────────────────────────────────

const MESSAGE_MAX = 200
const SLUG_MAX = 48
// The SDK mints `att-<uuid>` or `<millis>-<hex>`; both are URL- and log-safe slugs.
const ATTEMPT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,99}$/
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g
const TOKEN_RES = [
  /\b(?:pk|sk|rk|pcsk|whsec|rzp)_(?:live|test)_[A-Za-z0-9]{6,}/g, // publishable / secret / webhook keys
  /\b(?:sk|whsec|pcsk)_[A-Za-z0-9]{12,}/g, // unprefixed-mode secrets
  /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, // JWTs
]

/** The attempt id if it is a well-formed one, else null — a malformed id never reaches a table. */
export function normaliseAttemptId(v: unknown): string | null {
  if (typeof v !== "string") return null
  const s = v.trim()
  return ATTEMPT_ID_RE.test(s) ? s : null
}

/** A provider / SDK message made safe to store: no email, no credential, at most 200 characters. */
export function sanitiseMessage(msg: string | null | undefined): string | null {
  if (typeof msg !== "string" || !msg) return null
  let cleaned = msg.replace(EMAIL_RE, "[email]")
  for (const re of TOKEN_RES) cleaned = cleaned.replace(re, "[token]")
  cleaned = cleaned.replace(/\s+/g, " ").trim()
  if (!cleaned) return null
  return cleaned.length > MESSAGE_MAX ? cleaned.slice(0, MESSAGE_MAX) : cleaned
}

/** A code or class as a short lowercase slug ([a-z0-9_:.-], ≤ 48) — groupable, never free text. */
export function sanitiseCode(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined) return null
  const slug = String(v).toLowerCase().replace(/[^a-z0-9_:.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, SLUG_MAX)
  return slug || null
}

const EDGES: Record<AttemptState, readonly AttemptState[]> = {
  started: ["checkout_opened", "provider_result", "abandoned", "failed"],
  checkout_opened: ["provider_result", "abandoned", "failed"],
  provider_result: ["granted", "failed", "paid_not_granted"],
  abandoned: ["provider_result", "granted"],
  failed: ["provider_result", "granted"],
  paid_not_granted: ["granted"],
  granted: [],
}

/** Whether the migration 210 guard accepts `from → to` (same-state writes are no-ops, not transitions). */
export function canTransition(from: AttemptState, to: AttemptState): boolean {
  return EDGES[from]?.includes(to) ?? false
}

function failureColumns(f: AttemptFailure): Record<string, string | null> {
  return {
    stage: f.stage,
    error_class: sanitiseCode(f.error_class),
    error_code: sanitiseCode(f.error_code ?? null),
    error_message: sanitiseMessage(f.error_message ?? null),
  }
}

const idOr = (v: unknown): string | null => normaliseAttemptId(v)

// ── Resolvers: the attempt id each provider echoes back ─────────────────────────────────────────────

/** Stripe Checkout Session (or Subscription): `metadata.attempt_id`, else `client_reference_id`. */
export function resolveAttemptIdFromStripe(session: Any): string | null {
  return idOr(session?.metadata?.attempt_id) ?? idOr(session?.client_reference_id)
}

/** A Razorpay entity (subscription, payment, payment link): `notes.attempt_id`. */
export function resolveAttemptIdFromRazorpay(entity: Any): string | null {
  const notes = entity?.notes
  return notes && !Array.isArray(notes) ? idOr(notes.attempt_id) : null
}

/** A Razorpay webhook `payload`: whichever entity the event carries. */
export function resolveAttemptIdFromRazorpayEvent(payload: Any): string | null {
  return resolveAttemptIdFromRazorpay(payload?.subscription?.entity) ??
    resolveAttemptIdFromRazorpay(payload?.payment?.entity) ??
    resolveAttemptIdFromRazorpay(payload?.payment_link?.entity)
}

/** A Cashfree webhook `data`: the order's `order_tags.paycraft_attempt_id`. */
export function resolveAttemptIdFromCashfree(data: Any): string | null {
  return idOr(data?.order?.order_tags?.paycraft_attempt_id)
}

/** A Play subscriptionsv2 / products purchase: `obfuscatedExternalProfileId`. */
export function resolveAttemptIdFromPlay(truth: Any): string | null {
  return idOr(truth?.externalAccountIdentifiers?.obfuscatedExternalProfileId) ??
    idOr(truth?.obfuscatedExternalProfileId)
}

const PLAY_KEY = (purchaseToken: string) => `play:${purchaseToken}`

/** The attempt register-appstore mapped to this Apple original_transaction_id, or null. */
export async function resolveAttemptIdForAppStoreTxn(db: Any, originalTransactionId: string): Promise<string | null> {
  if (!originalTransactionId) return null
  const { data, error } = await db.from("appstore_txn_attempt_map")
    .select("attempt_id").eq("original_transaction_id", originalTransactionId).maybeSingle()
  if (error) throw new Error(`appstore_txn_attempt_map read failed: ${error.message}`)
  return (data?.attempt_id as string | undefined) ?? null
}

/** The attempt register-play-purchase mapped to this purchase token (an SDK too old to set the profile id). */
export function resolveAttemptIdForPlayToken(db: Any, purchaseToken: string): Promise<string | null> {
  return resolveAttemptIdForAppStoreTxn(db, PLAY_KEY(purchaseToken))
}

/** register-appstore: remember which attempt this Apple transaction belongs to. Idempotent. */
export async function mapAppStoreTxnToAttempt(
  db: Any,
  tenantId: string,
  originalTransactionId: string,
  attemptId: string,
): Promise<void> {
  const { error } = await db.from("appstore_txn_attempt_map").upsert(
    { tenant_id: tenantId, original_transaction_id: originalTransactionId, attempt_id: attemptId },
    { onConflict: "original_transaction_id" },
  )
  if (error) throw new Error(`appstore_txn_attempt_map write failed: ${error.message}`)
}

/** register-play-purchase: remember which attempt this purchase token belongs to. Idempotent. */
export function mapPlayTokenToAttempt(db: Any, tenantId: string, purchaseToken: string, attemptId: string): Promise<void> {
  return mapAppStoreTxnToAttempt(db, tenantId, PLAY_KEY(purchaseToken), attemptId)
}

// ── State helpers ───────────────────────────────────────────────────────────────────────────────────

async function readAttempt(db: Any, attemptId: string): Promise<{ state: AttemptState; tenant_id: string } | null> {
  const { data, error } = await db.from("checkout_attempts")
    .select("state, tenant_id").eq("attempt_id", attemptId).maybeSingle()
  if (error) throw new Error(`checkout_attempts read failed: ${error.message}`)
  return data ?? null
}

/** The guard's own refusal (migration 210) — an expected outcome for a replay or a late event. */
function isGuardRefusal(error: { code?: string; message?: string }): boolean {
  return error.code === "23514" && /^attempt_(?:illegal_transition|terminal)/.test(error.message ?? "")
}

/**
 * Open an attempt the SDK named. Insert-or-nothing: a second open (a retried request) never resets an
 * attempt that has already moved on. Returns whether this call created it.
 */
export async function openAttempt(db: Any, i: OpenAttemptInput): Promise<boolean> {
  const email = typeof i.email === "string" && i.email.trim() ? i.email.trim().toLowerCase() : null
  const appUserId = typeof i.app_user_id === "string" && i.app_user_id.trim() ? i.app_user_id.trim() : null
  if (!email && !appUserId) {
    // checkout_attempts_who (188): an attempt belongs to a buyer the merchant can follow up.
    throw new Error(`openAttempt ${i.attempt_id}: an email or an app_user_id is required`)
  }
  const { data, error } = await db.from("checkout_attempts").upsert({
    attempt_id: i.attempt_id,
    tenant_id: i.tenant_id,
    provider: i.provider,
    mode: i.mode,
    app_user_id: appUserId,
    email,
    plan: i.plan ?? null,
    // 186's NOT NULL outcome column only knows how an attempt that did not buy ended; an open attempt
    // carries 'abandoned' until it moves — tenant_customers_view lists only closed, unsuccessful states.
    outcome: "abandoned",
    provider_session_id: i.provider_session_id ?? i.attempt_id,
    state: i.state ?? "started",
    correlation: "exact",
  }, { onConflict: "attempt_id", ignoreDuplicates: true }).select("attempt_id")
  if (error?.code === "23505") return adoptLegacyRow(db, i)
  if (error) throw new Error(`openAttempt ${i.attempt_id}: ${error.message}`)
  return Array.isArray(data) && data.length > 0
}

/**
 * The provider key is already taken by a row an OLD writer made for this same attempt — 188's
 * record_store_attempt keys a store attempt on the SDK's attempt id. That row IS this attempt: it takes the
 * id (correlation exact) instead of a second row being made. A row already carrying another id is left alone.
 */
async function adoptLegacyRow(db: Any, i: OpenAttemptInput): Promise<boolean> {
  const { data, error } = await db.from("checkout_attempts")
    .update({ attempt_id: i.attempt_id, correlation: "exact", match_rule: null })
    .eq("provider", i.provider)
    .eq("provider_session_id", i.provider_session_id ?? i.attempt_id)
    .is("attempt_id", null)
    .select("attempt_id")
  if (error) throw new Error(`openAttempt ${i.attempt_id} (adopt): ${error.message}`)
  return Array.isArray(data) && data.length > 0
}

/**
 * Move an attempt to [next], writing [extra] with it. Returns true when the row moved; false when the id
 * is unknown, the attempt is already in [next] (a redelivery), or the guard refuses the edge.
 */
export async function transitionAttempt(
  db: Any,
  attemptId: string,
  next: AttemptState,
  extra: Record<string, unknown> = {},
): Promise<boolean> {
  const { data, error } = await db.from("checkout_attempts")
    .update({ ...extra, state: next })
    .eq("attempt_id", attemptId)
    .neq("state", next)
    .select("attempt_id")
  if (error) {
    if (isGuardRefusal(error)) {
      // A granted attempt refusing a later event (a renewal, a redelivery) is routine; an undeclared edge
      // on an open attempt is worth a log line.
      if (!String(error.message).startsWith("attempt_terminal")) {
        console.warn(`[payment-attempts] ${attemptId} → ${next} refused: ${error.message}`)
      }
      return false
    }
    throw new Error(`attempt_transition ${attemptId} → ${next}: ${error.message}`)
  }
  return Array.isArray(data) && data.length > 0
}

/**
 * The entitlement was written: close the attempt as granted. A grant implies the provider was paid, so an
 * attempt still at started / checkout_opened first records that provider result (at the same instant).
 */
export async function closeAsGranted(db: Any, attemptId: string, at: Date = new Date()): Promise<boolean> {
  const row = await readAttempt(db, attemptId)
  if (!row || row.state === "granted") return false
  const iso = at.toISOString()
  if (row.state === "started" || row.state === "checkout_opened") {
    await transitionAttempt(db, attemptId, "provider_result", { paid_at: iso })
  }
  return transitionAttempt(db, attemptId, "granted", { granted_at: iso, closed_at: iso })
}

/**
 * Close the attempt as failed with a structured reason. When the attempt cannot move (already granted,
 * or past the point a failure applies), the failure is appended to its timeline instead — never lost.
 * Returns whether the attempt itself moved to failed.
 */
export async function closeAsFailed(db: Any, attemptId: string, f: AttemptFailure, at: Date = new Date()): Promise<boolean> {
  const moved = await transitionAttempt(db, attemptId, "failed", {
    outcome: "payment_failed",
    closed_at: at.toISOString(),
    ...failureColumns(f),
  })
  if (moved) return true
  await noteOnTimeline(db, attemptId, f.stage, "failure", f)
  return false
}

/**
 * A failure of an attempt the caller may never have opened (a register call that failed before the
 * provider's answer was read): closes it when it exists, else records the failure on the timeline under
 * [tenantId] so it is never lost. Returns whether an attempt moved to failed.
 */
export async function recordAttemptFailure(
  db: Any,
  attemptId: string,
  tenantId: string | null,
  f: AttemptFailure,
): Promise<boolean> {
  const moved = await transitionAttempt(db, attemptId, "failed", {
    outcome: "payment_failed",
    closed_at: new Date().toISOString(),
    ...failureColumns(f),
  })
  if (moved) return true
  const noted = await noteOnTimeline(db, attemptId, f.stage, "failure", f)
  if (!noted && tenantId) await appendEvent(db, attemptId, tenantId, f.stage, "failure", f)
  return false
}

/**
 * Append [event] to the timeline of an attempt the caller only knows by id — on the attempt's OWN tenant,
 * read from its row. Returns false when no such attempt exists.
 */
export async function noteOnTimeline(
  db: Any,
  attemptId: string,
  stage: AttemptStage,
  event: string,
  f?: Partial<AttemptFailure> | null,
): Promise<boolean> {
  const row = await readAttempt(db, attemptId)
  if (!row) return false
  await appendEvent(db, attemptId, row.tenant_id, stage, event, f)
  return true
}

/**
 * A provider reported how a checkout ended without a purchase (expired, cancelled, declined). The attempt
 * closes as abandoned / failed with the provider's reason; when it cannot move (it was granted meanwhile,
 * or already closed) the report is kept on its timeline instead.
 */
export async function recordProviderOutcome(
  db: Any,
  attemptId: string,
  outcome: "abandoned" | "payment_failed",
  f: AttemptFailure,
): Promise<boolean> {
  if (outcome === "payment_failed") return closeAsFailed(db, attemptId, f)
  const moved = await closeAsAbandoned(db, attemptId, f)
  if (!moved) await noteOnTimeline(db, attemptId, f.stage, "provider_abandoned", f)
  return moved
}

/** Close the attempt as abandoned (the buyer left), with the reason when one is known. */
export async function closeAsAbandoned(
  db: Any,
  attemptId: string,
  f: AttemptFailure | null = null,
  at: Date = new Date(),
): Promise<boolean> {
  return transitionAttempt(db, attemptId, "abandoned", {
    outcome: "abandoned",
    closed_at: at.toISOString(),
    ...(f ? failureColumns(f) : {}),
  })
}

/** Append one row to the attempt's timeline (a breadcrumb, or a failure the state cannot carry). */
export async function appendEvent(
  db: Any,
  attemptId: string,
  tenantId: string,
  stage: AttemptStage,
  event: string,
  f?: Partial<AttemptFailure> | null,
): Promise<void> {
  const { error } = await db.from("attempt_events").insert({
    attempt_id: attemptId,
    tenant_id: tenantId,
    stage,
    event: event.slice(0, 64),
    error_class: sanitiseCode(f?.error_class ?? null),
    error_code: sanitiseCode(f?.error_code ?? null),
    error_message: sanitiseMessage(f?.error_message ?? null),
  })
  if (error) throw new Error(`attempt_events append ${attemptId}/${event}: ${error.message}`)
}

/** One timeline row for [appendEvents]. */
export interface TimelineItem {
  attemptId: string
  stage: AttemptStage
  event: string
  failure?: Partial<AttemptFailure> | null
  /** When it happened (the SDK's own clock for SDK events); now when absent. */
  at?: string | null
}

/** Append several timeline rows of one tenant in a single write (the events ingest's batches). */
export async function appendEvents(db: Any, tenantId: string, items: TimelineItem[]): Promise<void> {
  if (!items.length) return
  const { error } = await db.from("attempt_events").insert(items.map((t) => ({
    attempt_id: t.attemptId,
    tenant_id: tenantId,
    stage: t.stage,
    event: t.event.slice(0, 64),
    error_class: sanitiseCode(t.failure?.error_class ?? null),
    error_code: sanitiseCode(t.failure?.error_code ?? null),
    error_message: sanitiseMessage(t.failure?.error_message ?? null),
    ...(t.at ? { occurred_at: t.at } : {}),
  })))
  if (error) throw new Error(`attempt_events append (${items.length} rows): ${error.message}`)
}

/**
 * Run attempt bookkeeping without ever failing the payment path it rides on: a webhook must still grant,
 * and a checkout must still open, when the attempt record cannot be written. The error is logged with its
 * label so it is visible in the function logs.
 */
export async function attemptBestEffort<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn()
  } catch (e) {
    console.error(`[payment-attempts] ${label}: ${(e as Error).message}`)
    return null
  }
}

/**
 * A webhook whose signature did not verify named an attempt. The payload is untrusted, so nothing about the
 * attempt changes — but when the id belongs to a real attempt its timeline records the refusal (stage
 * `webhook`, class `signature`), which is how an owner learns a provider secret is wrong while buyers pay.
 */
export function noteWebhookSignatureFailure(db: Any, attemptId: string, provider: string, detail: string): Promise<boolean> {
  return noteOnTimeline(db, attemptId, "webhook", "signature_failed", {
    error_class: "signature",
    error_code: `${provider}_signature`,
    error_message: detail,
  })
}
