// The backend half of /health: supabase/functions/health checks what a paying customer feels —
// database, Stripe delivering every live event, webhook failures — and records/alerts incidents
// (migration 185). The dashboard folds those checks into its own answer so ONE public URL,
// paycraft.mobilebytesensei.com/health, covers both, and every poll of it also drives the alerts.

export type HealthCheck = { name: string; ok: boolean; detail?: string; duration_ms?: number }

type BackendBody = { checks?: Record<string, { ok?: boolean; detail?: string }> }

/** Backend checks as dashboard checks, prefixed `backend:`; an unreadable answer is a failure, never a pass. */
export function backendChecks(status: number, body: BackendBody | null, durationMs: number): HealthCheck[] {
  const entries = Object.entries(body?.checks ?? {})
  if (entries.length === 0) {
    return [{ name: "backend", ok: false, detail: `health function answered ${status} without checks`, duration_ms: durationMs }]
  }
  return entries.map(([name, c]) => ({ name: `backend:${name}`, ok: c.ok === true, detail: c.detail, duration_ms: durationMs }))
}

export async function checkBackend(supabaseUrl: string, fetchFn: typeof fetch = fetch): Promise<HealthCheck[]> {
  const start = Date.now()
  try {
    const res = await fetchFn(`${supabaseUrl}/functions/v1/health`, { cache: "no-store", signal: AbortSignal.timeout(25_000) })
    const body = (await res.json().catch(() => null)) as BackendBody | null
    return backendChecks(res.status, body, Date.now() - start)
  } catch (e) {
    return [{ name: "backend", ok: false, detail: `unreachable: ${e instanceof Error ? e.message : String(e)}`, duration_ms: Date.now() - start }]
  }
}
