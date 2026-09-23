import { Badge } from "@/components/ui/badge"

export interface ProviderModeReadiness {
  provider: string
  auth_kind: "key_pair" | "store"
  is_active: boolean
  live_ready: boolean
  test_ready: boolean
  live_detail: string
  test_detail: string
  test_mechanism: string
  human_action: string | null
  manual_steps?: string[] | null
  console_url?: string | null
}

/** Plain-English name for how THIS provider achieves test mode. */
function mechanismLabel(mechanism: string): string {
  switch (mechanism) {
    case "license_tester":
      return "Play license tester"
    case "sandbox_apple_id":
      return "sandbox Apple ID"
    default:
      return "test API key"
  }
}

/**
 * LIVE / TEST state for one provider.
 *
 * Two badges rather than one "Active", because a single status cannot say the thing that matters:
 * a provider can bill real customers perfectly while offering no way to test a purchase without
 * real money. On cappy, stripe read `connected=true` with zero test payment links — true, and
 * useless to a developer whose checkout button did nothing.
 *
 * TEST-NOT-READY IS AMBER, NOT RED. It is not a fault — most tenants simply have not set it up, and
 * a red badge for a normal state trains people to ignore the colour. Red is reserved for LIVE not
 * ready, which means real customers cannot pay.
 */
export function ModeReadiness({ r }: { r: ProviderModeReadiness }) {
  return (
    <div className="mt-3 space-y-2">
      <div className="flex items-center gap-2">
        <Badge tone={r.live_ready ? "success" : "danger"} dot>
          LIVE {r.live_ready ? "ready" : "not ready"}
        </Badge>
        <Badge tone={r.test_ready ? "success" : "warning"} dot>
          TEST {r.test_ready ? "ready" : "not set up"}
        </Badge>
        <span className="text-[10px] text-ink-400 uppercase tracking-tight">
          via {mechanismLabel(r.test_mechanism)}
        </span>
      </div>

      <dl className="text-[11px] leading-snug text-ink-500 space-y-0.5">
        <div className="flex gap-1.5">
          <dt className="font-semibold text-ink-600 shrink-0">Live</dt>
          <dd>{r.live_detail}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="font-semibold text-ink-600 shrink-0">Test</dt>
          <dd>{r.test_detail}</dd>
        </div>
      </dl>

      {(r.manual_steps?.length || r.human_action) && (
        // Verbatim from the RPC — ONE source of truth for what to do, shared with /idea-paycraft.
        // Restating it in the UI would let the dashboard and the CLI give a developer two different
        // instructions for the same gap.
        //
        // Steps when the RPC provides them, the paragraph otherwise. Play and App Store test mode
        // has no API to call, so these instructions ARE the feature — a wall of prose is the
        // difference between a gap someone closes and one they keep scrolling past.
        <div className="text-[11px] leading-snug rounded-md bg-amber-50 border border-amber-200 text-amber-900 px-2.5 py-2 space-y-1.5">
          {r.manual_steps?.length ? (
            <>
              <p className="font-semibold">Manual steps — no API can do this:</p>
              <ol className="list-decimal pl-4 space-y-1">
                {r.manual_steps.map((step, i) => (
                  <li key={i}>{step}</li>
                ))}
              </ol>
            </>
          ) : (
            <p>{r.human_action}</p>
          )}
          {r.console_url && (
            <a
              href={r.console_url}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-block font-semibold underline underline-offset-2 hover:no-underline"
            >
              Open {mechanismLabel(r.test_mechanism)} console →
            </a>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * One-line summary above the provider grid.
 *
 * Answers "can I develop against this tenant at all?" before the reader scans individual cards —
 * the question that sent someone debugging a paywall for a day when the real answer was "no
 * provider on this tenant can transact a test purchase".
 */
export function ModeReadinessSummary({ rows }: { rows: ProviderModeReadiness[] }) {
  const active = rows.filter((r) => r.is_active)
  if (active.length === 0) return null

  const liveOk = active.filter((r) => r.live_ready).length
  const testOk = active.filter((r) => r.test_ready).length

  if (testOk > 0) {
    return (
      <p className="text-xs text-ink-500 mb-4">
        {liveOk}/{active.length} provider(s) ready for live, {testOk}/{active.length} for test.
      </p>
    )
  }

  return (
    <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-sm font-semibold text-amber-900">
        No provider can transact a test purchase
      </p>
      <p className="text-xs text-amber-800 mt-1">
        {liveOk}/{active.length} are ready for live. Until at least one supports test mode, the only
        way to exercise a checkout on this tenant is with real money — a debug build resolves no
        payment link and its button does nothing. Each card below names the one step it needs.
      </p>
    </div>
  )
}
