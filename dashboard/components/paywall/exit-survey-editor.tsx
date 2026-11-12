"use client"

// Paywall ▸ Exit survey (paycraft-paywall-analytics T15, GOAL D6). What a buyer is asked when they close the paywall
// or leave checkout without paying, and what each answer does: a win-back coupon, a message, or nothing. Saved
// through /api/exit-survey (tenant_exit_survey_save owns the rules); apps pick it up with their next /config.

import { useMemo, useState } from "react"
import Link from "next/link"
import { Check, AlertTriangle, MessageSquareText, Smartphone, Monitor } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import {
  type CouponLanes,
  type ReasonAction,
  type SurveyDraft,
  type SurveyReason,
  laneReadiness,
  surveyErrorMessage,
  validateSurvey,
} from "@/lib/exit-survey-config"

export type EditorCoupon = CouponLanes & { id: string; code: string; percent_off: number; duration: string; duration_in_months: number | null }

const ACTIONS: { value: ReasonAction; label: string }[] = [
  { value: "offer", label: "Offer" },
  { value: "message", label: "Show message" },
  { value: "none", label: "Nothing" },
]

function Toggle({ on, onChange, label, testId }: { on: boolean; onChange: (v: boolean) => void; label: string; testId?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-testid={testId}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-5 w-9 flex-none items-center rounded-full transition-colors ${on ? "bg-brand-600" : "bg-ink-300 dark:bg-ink-600"}`}
    >
      <span className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${on ? "translate-x-[18px]" : "translate-x-0.5"}`} />
    </button>
  )
}

function couponLabel(c: EditorCoupon): string {
  const term = c.duration === "forever" ? "forever" : c.duration === "repeating" ? `${c.duration_in_months ?? "?"} mo` : "first payment"
  return `${c.code} — ${c.percent_off}% off, ${term}`
}

export function ExitSurveyEditor({
  initial,
  coupons,
  productCount,
}: {
  initial: SurveyDraft
  coupons: EditorCoupon[]
  productCount: number
}) {
  const [s, setS] = useState<SurveyDraft>(initial)
  const [saving, setSaving] = useState(false)
  const [savedAt, setSavedAt] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [preview, setPreview] = useState<"mobile" | "web">("mobile")

  const couponIds = useMemo(() => coupons.map((c) => c.id), [coupons])
  const problem = validateSurvey(s, couponIds)
  const shownError = serverError ?? problem
  const edit = (patch: Partial<SurveyDraft>) => {
    setS((cur) => ({ ...cur, ...patch }))
    setSavedAt(null)
    setServerError(null)
  }
  const editReason = (i: number, patch: Partial<SurveyReason>) =>
    edit({ reasons: s.reasons.map((r, j) => (j === i ? { ...r, ...patch } : r)) })

  async function save() {
    if (problem) return
    setSaving(true)
    const res = await fetch("/api/exit-survey", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(s) })
    setSaving(false)
    if (res.ok) {
      setSavedAt(new Date().toLocaleTimeString())
    } else {
      const body = await res.json().catch(() => ({}))
      setServerError(String(body.error ?? "save_failed"))
    }
  }

  const live = s.reasons.filter((r) => r.enabled !== false)

  return (
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]" data-testid="exit-survey-editor">
      <div className="flex min-w-0 flex-col gap-6">
        <Card>
          <CardHeader
            title="Survey"
            subtitle="Asked once when a buyer closes the paywall or leaves checkout without paying."
            action={
              <label className="flex items-center gap-2 text-sm font-medium text-ink-700 dark:text-ink-200">
                {s.enabled ? "Enabled" : "Off"}
                <Toggle on={s.enabled} onChange={(v) => edit({ enabled: v })} label="Survey enabled" testId="survey-enabled" />
              </label>
            }
          />
          <CardBody className="grid gap-4 sm:grid-cols-[1fr_auto_auto]">
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-ink-700 dark:text-ink-200">Question</span>
              <input className="input" maxLength={80} value={s.title} onChange={(e) => edit({ title: e.target.value })} data-testid="survey-title" />
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-ink-700 dark:text-ink-200">Ask again after</span>
              <span className="flex items-center gap-2">
                <input className="input w-20" type="number" min={1} max={90} value={s.survey_cap_days}
                  onChange={(e) => edit({ survey_cap_days: Number(e.target.value) })} data-testid="survey-cap" />
                <span className="text-ink-500">days</span>
              </span>
            </label>
            <label className="grid gap-1.5 text-sm">
              <span className="font-medium text-ink-700 dark:text-ink-200">An offer lasts</span>
              <span className="flex items-center gap-2">
                <input className="input w-20" type="number" min={1} max={720} value={s.offer_hours}
                  onChange={(e) => edit({ offer_hours: Number(e.target.value) })} />
                <span className="text-ink-500">hours</span>
              </span>
            </label>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Reasons" subtitle="What each answer does. Only switched-on reasons are shown, in this order." />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-left text-xs font-semibold uppercase tracking-wide text-ink-500 dark:border-ink-800">
                  <th className="w-[32%] px-5 py-2.5">Reason</th>
                  <th className="w-14 px-3 py-2.5">On</th>
                  <th className="w-44 px-3 py-2.5">When chosen</th>
                  <th className="px-5 py-2.5">Detail</th>
                </tr>
              </thead>
              <tbody>
                {s.reasons.map((r, i) => {
                  const coupon = coupons.find((c) => c.id === r.coupon_id)
                  return (
                    <tr key={r.code} className="border-b border-ink-100 align-top last:border-0 dark:border-ink-800" data-testid={`reason-${r.code}`}>
                      <td className="px-5 py-3">
                        <input className="input" maxLength={60} value={r.label} onChange={(e) => editReason(i, { label: e.target.value })} aria-label={`Label for ${r.code}`} />
                        <p className="mt-1 text-xs text-ink-400">
                          <code>{r.code}</code>
                          {r.free_text && <span className="ml-2 inline-flex items-center gap-1"><MessageSquareText className="h-3 w-3" />free text</span>}
                        </p>
                      </td>
                      <td className="px-3 py-3 pt-5">
                        <Toggle on={r.enabled !== false} onChange={(v) => editReason(i, { enabled: v })} label={`Show “${r.label}”`} />
                      </td>
                      <td className="px-3 py-3">
                        <select className="input w-full" value={r.action} onChange={(e) => editReason(i, { action: e.target.value as ReasonAction })} aria-label={`Action for ${r.code}`}>
                          {ACTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
                        </select>
                      </td>
                      <td className="px-5 py-3">
                        {r.action === "offer" && (
                          <div className="grid gap-2">
                            <select className="input" value={r.coupon_id ?? ""} onChange={(e) => editReason(i, { coupon_id: e.target.value || null })} aria-label={`Coupon for ${r.code}`} data-testid={`coupon-${r.code}`}>
                              <option value="">Pick a coupon…</option>
                              {coupons.map((c) => <option key={c.id} value={c.id}>{couponLabel(c)}</option>)}
                            </select>
                            {coupon && (
                              <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs" aria-label="Where this discount applies">
                                {laneReadiness(coupon, productCount).map((l) => (
                                  <li key={l.lane} className={`inline-flex items-center gap-1 ${l.ready ? "text-success-700" : "text-warning-700"}`}>
                                    {l.ready ? <Check className="h-3 w-3" strokeWidth={2.5} /> : <AlertTriangle className="h-3 w-3" />}
                                    {l.lane}{l.note ? ` · ${l.note}` : ""}
                                  </li>
                                ))}
                              </ul>
                            )}
                            {coupons.length === 0 && (
                              <p className="text-xs text-ink-500">No coupons yet — <Link href="/coupons" className="font-medium text-brand-700 underline">create one</Link>.</p>
                            )}
                          </div>
                        )}
                        {r.action === "message" && (
                          <textarea className="input min-h-[84px]" maxLength={200} value={r.message ?? ""} placeholder="e.g. We also accept UPI on our website."
                            onChange={(e) => editReason(i, { message: e.target.value })} aria-label={`Message for ${r.code}`} />
                        )}
                        {r.action === "none" && <p className="pt-2 text-xs text-ink-400">The survey closes.</p>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="border-t border-ink-100 px-5 py-3 text-xs text-ink-500 dark:border-ink-800">
            A discount reaches a buyer only on lanes where the coupon exists — Stripe and Razorpay on the web, a Play offer id or an
            App Store promotional offer per product in the apps. Set those up on <Link href="/coupons" className="font-medium text-brand-700 underline">Coupons</Link>.
          </p>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" onClick={save} loading={saving} disabled={!!problem} data-testid="survey-save">Save survey</Button>
          {shownError && (
            <p className="text-sm text-danger-700" role="alert" data-testid="survey-error">{surveyErrorMessage(shownError, s.reasons)}</p>
          )}
          {savedAt && !shownError && (
            <p className="flex items-center gap-1.5 text-sm text-success-700" role="status" data-testid="survey-saved">
              <Check className="h-4 w-4" strokeWidth={2.5} />Saved at <span className="tabular-nums">{savedAt}</span> — live in apps within 5 min.
            </p>
          )}
        </div>
      </div>

      <aside className="xl:sticky xl:top-6 xl:self-start" aria-label="Preview">
        <div className="mb-3 flex items-center justify-between">
          <span className="text-xs font-bold uppercase tracking-widest text-ink-400">Preview</span>
          <div className="inline-flex rounded-md border border-ink-200 p-0.5 text-xs dark:border-ink-700">
            {(["mobile", "web"] as const).map((p) => (
              <button key={p} type="button" onClick={() => setPreview(p)} aria-pressed={preview === p}
                className={`inline-flex items-center gap-1 rounded px-2 py-1 font-medium ${preview === p ? "bg-ink-900 text-white dark:bg-white dark:text-ink-900" : "text-ink-500"}`}>
                {p === "mobile" ? <Smartphone className="h-3 w-3" /> : <Monitor className="h-3 w-3" />}{p === "mobile" ? "App sheet" : "Web dialog"}
              </button>
            ))}
          </div>
        </div>
        <div className={`relative overflow-hidden rounded-2xl bg-ink-800/80 ${preview === "mobile" ? "flex h-[460px] items-end" : "flex h-[340px] items-center p-4"}`} data-testid="survey-preview">
          {!s.enabled || live.length === 0 ? (
            <p className="m-auto px-6 text-center text-sm text-ink-200">The survey is off — buyers simply leave.</p>
          ) : (
            <div className={`w-full bg-white p-4 text-ink-900 ${preview === "mobile" ? "rounded-t-2xl" : "rounded-xl"}`}>
              <p className="mb-3 pr-6 text-[15px] font-bold leading-snug">{s.title || "…"}</p>
              <ul className={`grid gap-2 ${preview === "web" ? "grid-cols-2" : ""}`}>
                {live.map((r) => (
                  <li key={r.code} className={`rounded-lg border border-ink-200 px-3 py-2 text-[13px] font-medium ${r.free_text && preview === "web" ? "col-span-2" : ""}`}>{r.label || "…"}</li>
                ))}
              </ul>
              <p className="mt-3 text-center text-xs text-ink-500">Skip</p>
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
