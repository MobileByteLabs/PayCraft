import React from "react"
import { clsx } from "clsx"
import { Sparkles } from "lucide-react"

/**
 * What Claude found about this app's users (paycraft-ga4-analytics-audit D7) — `analytics_findings`, written by the
 * weekly digest and by /idea-paycraft-analytics. Open findings first (what still needs doing), then what was fixed
 * or dismissed, each with the evidence-backed proposal and, once handled, what was done.
 */
export type AuditFinding = {
  id: string
  kind: string
  severity: "critical" | "high" | "medium" | "low"
  title: string
  summary: string | null
  proposed_fix: string | null
  status: "open" | "fixed" | "dismissed"
  fixed_note: string | null
  source: "digest" | "command"
  window_start: string
  window_end: string
  created_at: string
}

const SEVERITY_TONE: Record<AuditFinding["severity"], string> = {
  critical: "bg-danger-50 text-danger-700 ring-danger-100",
  high: "bg-warning-50 text-warning-700 ring-warning-100",
  medium: "bg-info-50 text-info-700 ring-info-100",
  low: "bg-ink-50 text-ink-600 ring-ink-100",
}

const ORDER: Record<AuditFinding["status"], number> = { open: 0, fixed: 1, dismissed: 2 }

export function AiAuditPanel({ findings }: { findings: AuditFinding[] }) {
  const sorted = [...findings].sort((a, b) => ORDER[a.status] - ORDER[b.status] || b.created_at.localeCompare(a.created_at))
  return (
    <section className="overflow-hidden rounded-xl border border-ink-200 bg-white shadow-sm" aria-labelledby="ai-audit-h">
      <div className="flex items-start gap-3 border-b border-ink-100 px-6 py-4">
        <span className="rounded-lg bg-brand-50 p-1.5 text-brand-600"><Sparkles className="h-4 w-4" strokeWidth={2} /></span>
        <div>
          <h3 id="ai-audit-h" className="text-base font-bold text-ink-900">AI audit</h3>
          <p className="mt-0.5 text-[11px] text-ink-500">What Claude found in this app&apos;s GA4 and payment data, and what was done about it</p>
        </div>
      </div>
      {sorted.length === 0 ? (
        <p className="m-4 rounded-lg border border-dashed border-ink-200 px-4 py-6 text-sm text-ink-500">
          No findings yet. The weekly digest adds them, and running <code className="font-mono">/idea-paycraft-analytics</code> audits
          this app now and fixes what it finds.
        </p>
      ) : (
        <ul className="divide-y divide-ink-100" aria-label="AI audit findings">
          {sorted.map((f) => (
            <li key={f.id} className={clsx("px-6 py-4", f.status !== "open" && "opacity-75")}>
              <div className="flex flex-wrap items-center gap-2">
                <span className={clsx("rounded-md px-2 py-0.5 text-[11px] font-bold uppercase ring-1 ring-inset", SEVERITY_TONE[f.severity])}>{f.severity}</span>
                <span className="text-sm font-semibold text-ink-900">{f.title}</span>
                <span className={clsx("ml-auto text-[11px] font-bold uppercase", f.status === "open" ? "text-danger-700" : f.status === "fixed" ? "text-success-700" : "text-ink-400")}>
                  {f.status}
                </span>
              </div>
              {f.summary && <p className="mt-1 text-sm text-ink-600">{f.summary}</p>}
              {f.status === "open" && f.proposed_fix && <p className="mt-1 text-sm text-ink-800"><span className="font-semibold">Proposed:</span> {f.proposed_fix}</p>}
              {f.status !== "open" && f.fixed_note && <p className="mt-1 text-sm text-success-700"><span className="font-semibold">Done:</span> {f.fixed_note}</p>}
              <p className="mt-1 text-[11px] text-ink-400">{f.window_start} → {f.window_end} · {f.source === "digest" ? "weekly digest" : "/idea-paycraft-analytics"}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
