import type { createClient } from "@/lib/supabase-server"

/**
 * Server-side request logging.
 *
 * Every stall in this system has been debugged from after-the-fact STATE — a `sync_state` column, a
 * badge, an `updated_at` — and twice that produced the wrong conclusion first: a "Synced 3 item(s)"
 * report for three products that were all skipped, and a `SYNC FAILED` badge read as current when
 * its verdict predated the fix by three minutes. State says what is; a log says what happened, and
 * when, and what the server was told.
 *
 * Two rules, both learned the hard way:
 *
 *  1. NEVER let logging change the outcome. A failed insert must not fail the request — the log is
 *     for us, the request is for the user. Every write here is best-effort and swallowed, which is
 *     the ONE place in this codebase where swallowing is correct.
 *  2. NEVER log a secret. `params`/`result` carry ids, counts, statuses and error messages. No keys,
 *     tokens, credentials, or payment-link URLs (a Razorpay short_url IS a payable link).
 *     Redaction is the caller's job: only the caller knows which of its fields are sensitive.
 */

type Supa = ReturnType<typeof createClient>

/**
 * Correlation id shared by a request and the sync_events rows it produces.
 *
 * MUST be a UUID. `sync_events.run_id` is a `uuid` column while `request_logs.run_id` is `text`, so
 * a readable-but-invented id like `req_m3x9f_a7c2` silently failed every sync_events insert — the
 * request log was written, the provider events were not, and the join the whole design rests on
 * produced nothing. A uuid satisfies both columns, which is the point of a shared correlation id.
 */
export function newRunId(): string {
  return crypto.randomUUID()
}

export interface RequestLogInput {
  route: string
  method: string
  tenantId?: string | null
  status?: number
  durationMs?: number
  /** Already-redacted inputs worth reproducing the call with. */
  params?: Record<string, unknown>
  /** Already-redacted outcome: counts, per-provider verdicts, error text. */
  result?: Record<string, unknown>
  error?: string | null
  runId?: string | null
}

/**
 * Fields that must never reach the log, matched by NAME on the way in. This is a backstop for
 * caller mistakes, not a substitute for the caller redacting — a nested or oddly-named secret will
 * still slip through, which is why rule 2 above puts the duty on the caller.
 */
const FORBIDDEN = /(secret|token|key|password|credential|authorization|short_url|payment_link)/i

function scrub(o: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!o) return {}
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(o)) {
    out[k] = FORBIDDEN.test(k) ? "[redacted]" : v
  }
  return out
}

export async function logRequest(supabase: Supa, input: RequestLogInput): Promise<void> {
  const line = {
    at: new Date().toISOString(),
    route: input.route,
    method: input.method,
    tenant: input.tenantId ?? null,
    status: input.status ?? null,
    ms: input.durationMs ?? null,
    run_id: input.runId ?? null,
    params: scrub(input.params),
    result: scrub(input.result),
    error: input.error ?? null,
  }
  // Structured stdout FIRST: it survives even when the DB write is the thing that is broken, and it
  // is what shows up in `next dev` output and in production logs.
  console.log(`[req] ${JSON.stringify(line)}`)

  try {
    await supabase.rpc("log_request", {
      p_route: input.route,
      p_method: input.method,
      p_tenant_id: input.tenantId ?? null,
      p_status: input.status ?? null,
      p_duration_ms: input.durationMs ?? null,
      p_params: scrub(input.params),
      p_result: scrub(input.result),
      p_error: input.error ?? null,
      p_run_id: input.runId ?? null,
    })
  } catch {
    // Intentionally swallowed — see rule 1. The console line above is already written.
  }
}

/**
 * Wrap a route handler so it is logged whether it returns or throws.
 *
 * `enrich` runs AFTER the handler and may read the response body the handler already built, so the
 * log can carry the outcome (synced/skipped/failed counts) rather than just the status code.
 */
export async function withRequestLog<T extends Response>(
  supabase: Supa,
  meta: { route: string; method: string; tenantId?: string | null; params?: Record<string, unknown>; runId?: string | null },
  handler: () => Promise<T>,
  enrich?: (res: T) => Promise<Record<string, unknown>> | Record<string, unknown>,
): Promise<T> {
  const started = Date.now()
  try {
    const res = await handler()
    let result: Record<string, unknown> = {}
    try {
      result = enrich ? await enrich(res) : {}
    } catch {
      // A broken enricher must not break the response either.
    }
    await logRequest(supabase, { ...meta, status: res.status, durationMs: Date.now() - started, result })
    return res
  } catch (e) {
    await logRequest(supabase, {
      ...meta,
      status: 500,
      durationMs: Date.now() - started,
      error: e instanceof Error ? e.message : String(e),
    })
    throw e
  }
}
