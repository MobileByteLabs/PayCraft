// supabase/functions/attempt-stitch/stitch.ts
//
// One stitch pass (paycraft-attempt-observability D1 / D7), with the database client and the clock passed
// in so it runs the same from the cron entrypoint and from tests.
//
//   1. Legacy inference. Rows an old writer made (no attempt_id, correlation NULL, not yet examined) get an
//      attempt id, `correlation = inferred` and the `match_rule` that identified them (match.ts). Every write
//      is filtered `correlation IS NULL`, so an EXACT attempt — one the SDK named — is never modified. A row
//      no rule identifies is marked `match_rule = 'none'` (still uncorrelated) so it is not re-examined.
//   2. The state machine, in SQL (attempt_stitch_run, migration 210) on the clock given here: provider paid
//      and no grant after 10 minutes → paid_not_granted; started / checkout_opened with nothing back after
//      the abandon timeout → abandoned. Both land on the attempt's timeline through the table's trigger.

import { appendEvent } from "../_shared/payment-attempts.ts"
import { inferredAttemptId, stitchMatch } from "./match.ts"

// deno-lint-ignore no-explicit-any
type Any = any

export const PAID_CUTOFF_MINUTES = 10
export const ABANDON_MINUTES = 120
const BATCH = 500

export interface StitchResult {
  stitched: number
  unmatched: number
  paid_not_granted: number
  abandoned: number
}

/** `?now=ISO` → that instant; absent → [fallback]; unparseable → null (the caller refuses the request). */
export function parseStitchClock(raw: string | null, fallback: Date): Date | null {
  if (raw === null || raw === "") return fallback
  const t = Date.parse(raw)
  return Number.isNaN(t) ? null : new Date(t)
}

/** Label one legacy row. Returns the attempt id it now carries, null when the row was already taken. */
async function inferRow(db: Any, row: { id: string; provider: string; provider_session_id: string }, rule: string): Promise<string | null> {
  const derived = await inferredAttemptId(row.provider, row.provider_session_id)
  // A store report keyed on the SDK's own id joins that id (the SDK's funnel events carry it too) — unless
  // an exact attempt already holds it, in which case the derived id keeps the two apart.
  const candidates = rule === "sdk_store_attempt_id" ? [row.provider_session_id, derived] : [derived]
  for (const attemptId of candidates) {
    const { data, error } = await db.from("checkout_attempts")
      .update({ attempt_id: attemptId, correlation: "inferred", match_rule: rule })
      .eq("id", row.id)
      .is("correlation", null)
      .select("id")
    if (error?.code === "23505") continue
    if (error) throw new Error(`stitch ${row.id}: ${error.message}`)
    return Array.isArray(data) && data.length > 0 ? attemptId : null
  }
  throw new Error(`stitch ${row.id}: no free attempt id`)
}

export async function stitchOnce(db: Any, now: Date): Promise<StitchResult> {
  let stitched = 0
  let unmatched = 0

  const { data: rows, error } = await db.from("checkout_attempts")
    .select("id, tenant_id, provider, provider_session_id")
    .is("attempt_id", null)
    .is("correlation", null)
    .is("match_rule", null)
    .order("occurred_at", { ascending: true })
    .limit(BATCH)
  if (error) throw new Error(`stitch candidates: ${error.message}`)

  for (const row of (rows ?? []) as Array<{ id: string; tenant_id: string; provider: string; provider_session_id: string }>) {
    const match = stitchMatch(row)
    if (!match) {
      const { error: e } = await db.from("checkout_attempts")
        .update({ match_rule: "none" })
        .eq("id", row.id)
        .is("correlation", null)
      if (e) throw new Error(`stitch ${row.id} (unmatched): ${e.message}`)
      unmatched++
      continue
    }
    const attemptId = await inferRow(db, row, match.match_rule)
    if (!attemptId) continue
    await appendEvent(db, attemptId, row.tenant_id, "server", `stitched:${match.match_rule}`)
    stitched++
  }

  const { data: sm, error: smErr } = await db.rpc("attempt_stitch_run", {
    p_now: now.toISOString(),
    p_paid_cutoff_minutes: PAID_CUTOFF_MINUTES,
    p_abandon_minutes: ABANDON_MINUTES,
  })
  if (smErr) throw new Error(`attempt_stitch_run: ${smErr.message}`)
  const counts = (Array.isArray(sm) ? sm[0] : sm) ?? {}
  return {
    stitched,
    unmatched,
    paid_not_granted: Number(counts.paid_not_granted ?? 0),
    abandoned: Number(counts.abandoned ?? 0),
  }
}
