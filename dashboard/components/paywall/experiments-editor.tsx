"use client"

// Paywall ▸ Experiments (migrations 206, 221, 227). A/B tests of which offering the paywall sells, which plan it
// pre-selects, the exit offer and the design: start from a template or from scratch, start it, stop it, read its
// results and make the winner the default. Saved through /api/experiments; the RPCs own the rules, lib/experiments
// mirrors them.

import { useEffect, useState } from "react"
import Link from "next/link"
import { Plus, Trash2, Trophy, FlaskConical } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import {
  EXPERIMENT_TEMPLATES,
  PAYWALL_TEMPLATES,
  type Experiment,
  type ExperimentDraft,
  type ExperimentVariant,
  type ResultRow,
  confidence,
  experimentErrorMessage,
  mainCurrency,
  revenuePerViewer,
  significance,
  uplift,
  validateExperiment,
  winner,
} from "@/lib/experiments"

/** [plans]: the offering's active plans — a variant may pre-select one of them (221). */
export type EditorOffering = {
  id: string
  identifier: string
  display_name: string
  is_current?: boolean
  plans?: { sku: string; display_name: string; interval?: string | null }[]
}

/** A percent-off coupon a variant can use as its exit offer (227). */
export type EditorCoupon = { id: string; code: string; percent_off: number; duration: string; duration_in_months: number | null }

const couponTerm = (c: EditorCoupon) =>
  `${c.percent_off}% off ${c.duration === "repeating" ? `for ${c.duration_in_months ?? "?"} mo` : c.duration === "forever" ? "forever" : "first payment"}`

/** The exit-offer select's value for a variant: "" = the tenant's, "off", or a coupon id. */
const exitChoice = (v: ExperimentVariant) => (v.exit_offer === false ? "off" : v.exit_offer_coupon_id ?? "")
const exitPatch = (value: string): Partial<ExperimentVariant> =>
  value === "off" ? { exit_offer: false, exit_offer_coupon_id: undefined }
    : value ? { exit_offer: undefined, exit_offer_coupon_id: value } : { exit_offer: undefined, exit_offer_coupon_id: undefined }

const STATUS_TONE = { draft: "neutral", running: "success", stopped: "info" } as const
const pct = (x: number) => `${(x * 100).toFixed(2)}%`

function Results({ experimentKey, canPromote, onPromote }: {
  experimentKey: string
  canPromote: boolean
  onPromote: (variant: string) => void
}) {
  const [rows, setRows] = useState<ResultRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/experiments?results=${encodeURIComponent(experimentKey)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (res.ok) setRows(body.results ?? [])
        else setError(String(body.error ?? "load_failed"))
      })
      .catch(() => setError("load_failed"))
  }, [experimentKey])

  if (error) return <p className="px-5 py-3 text-sm text-danger-700" role="alert">Results couldn't be loaded.</p>
  if (!rows) return <p className="px-5 py-3 text-sm text-ink-500">Loading results…</p>
  const control = rows[0]
  const currency = mainCurrency(rows)
  const best = winner(rows)
  const money = (x: number) => (currency ? new Intl.NumberFormat(undefined, { style: "currency", currency }).format(x) : "—")
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[860px] text-sm" data-testid={`results-${experimentKey}`}>
        <thead>
          <tr className="border-b border-ink-100 text-left text-xs font-semibold uppercase tracking-wide text-ink-500 dark:border-ink-800">
            <th className="px-5 py-2.5">Variant</th>
            <th className="px-3 py-2.5 text-right">Viewers</th>
            <th className="px-3 py-2.5 text-right">Buyers</th>
            <th className="px-3 py-2.5 text-right">Conversion</th>
            <th className="px-3 py-2.5 text-right">Revenue / viewer</th>
            <th className="px-3 py-2.5 text-right">Exit offer taken</th>
            <th className="px-3 py-2.5 text-right">Uplift</th>
            <th className="px-3 py-2.5">Confidence</th>
            <th className="px-5 py-2.5" />
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((r, i) => {
            const up = i === 0 ? null : uplift(Number(control.conversion), Number(r.conversion))
            const sig = i === 0 ? null : significance(control, r)
            const conf = i === 0 ? null : confidence(control, r)
            const views = Number(r.offer_views ?? 0)
            return (
              <tr key={r.variant} className="border-b border-ink-100 last:border-0 dark:border-ink-800">
                <td className="px-5 py-2.5 font-medium">
                  <code>{r.variant}</code>{i === 0 && <span className="ml-2 text-xs text-ink-400">control</span>}
                  {best === r.variant && i > 0 && <Badge tone="success" className="ml-2"><Trophy className="mr-1 inline h-3 w-3" />Winner</Badge>}
                </td>
                <td className="px-3 py-2.5 text-right">{r.viewers}</td>
                <td className="px-3 py-2.5 text-right">{r.buyers}</td>
                <td className="px-3 py-2.5 text-right">{pct(Number(r.conversion))}</td>
                <td className="px-3 py-2.5 text-right">{money(revenuePerViewer(r, currency))}</td>
                <td className="px-3 py-2.5 text-right">{views ? `${r.offer_accepts ?? 0} of ${views}` : "—"}</td>
                <td className="px-3 py-2.5 text-right">{i === 0 ? "—" : up === null ? "n/a" : `${up >= 0 ? "+" : ""}${(up * 100).toFixed(1)}%`}</td>
                <td className="px-3 py-2.5">
                  {sig && (conf === null
                    ? <Badge tone="neutral">No data</Badge>
                    : <Badge tone={sig.significant ? "success" : "neutral"}>{(conf * 100).toFixed(0)}%{sig.significant ? " · significant" : ""}</Badge>)}
                </td>
                <td className="px-5 py-2.5 text-right">
                  {canPromote && (
                    <Button type="button" size="sm" variant={best === r.variant ? "primary" : "ghost"} onClick={() => onPromote(r.variant)}
                      data-testid={`promote-${experimentKey}-${r.variant}`}>Make default</Button>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="border-t border-ink-100 px-5 py-2 text-xs text-ink-500 dark:border-ink-800">
        Distinct devices, live mode only. Revenue = catalogue price of what each buyer bought{currency ? ` (${currency})` : ""}.
        Confidence = how sure the difference from the control is real (two-proportion z-test); significant at 95% with at least 100 viewers per arm.
      </p>
    </div>
  )
}

export function ExperimentsEditor({
  initial,
  offerings,
  coupons = [],
  exitCouponId = null,
  onSaved,
}: {
  initial: Experiment[]
  offerings: EditorOffering[]
  /** Percent-off coupons a variant can use as its exit offer (227). */
  coupons?: EditorCoupon[]
  /** The tenant's exit-offer coupon (226); templates keep it on. */
  exitCouponId?: string | null
  /** Called after a successful save / status change (e.g. to invalidate the cached list). */
  onSaved?: () => void
}) {
  const [list, setList] = useState<Experiment[]>(initial)
  const [draft, setDraft] = useState<ExperimentDraft | null>(null)
  const [isNew, setIsNew] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const offeringIds = offerings.map((o) => o.id)
  const skusByOffering = Object.fromEntries(offerings.map((o) => [o.id, (o.plans ?? []).map((p) => p.sku)]))
  const problem = draft ? validateExperiment(draft, offeringIds, skusByOffering) : null
  const plansOf = (offeringId: string) => offerings.find((o) => o.id === offeringId)?.plans ?? []
  // A fresh form starts with an empty key: Save is already disabled, so the message waits for typing.
  const shownError = error ?? (draft?.key ? problem : null)

  const upsert = (e: Experiment) => setList((cur) => (cur.some((x) => x.key === e.key) ? cur.map((x) => (x.key === e.key ? e : x)) : [e, ...cur]))
  const edit = (patch: Partial<ExperimentDraft>) => { setDraft((d) => (d ? { ...d, ...patch } : d)); setError(null) }
  const editVariant = (i: number, patch: Partial<ExperimentDraft["variants"][number]>) =>
    draft && edit({ variants: draft.variants.map((v, j) => (j === i ? { ...v, ...patch } : v)) })

  function startNew() {
    const first = offerings[0]?.id ?? ""
    setDraft({ key: "", name: "", variants: [{ key: "control", weight: 50, offering_id: first }, { key: "variant-b", weight: 50, offering_id: first }] })
    setIsNew(true)
    setError(null)
  }

  const templateCtx = { offerings, coupons, exitCouponId, today: new Date().toISOString().slice(0, 10) }
  function applyTemplate(id: string) {
    const t = EXPERIMENT_TEMPLATES.find((x) => x.id === id)
    if (!t || t.needs(templateCtx)) return
    setDraft(t.build(templateCtx))
    setIsNew(true)
    setError(null)
  }

  async function promote(e: Experiment, variant: string) {
    const msg = `Make “${variant}” the default for everyone?${e.status === "running" ? " The experiment stops." : ""} Its offering, `
      + "pre-selected plan, exit offer and design become your paywall's settings."
    if (!confirm(msg)) return
    await call("POST", { key: e.key, promote: variant })
  }

  async function call(method: "PUT" | "POST", body: unknown): Promise<boolean> {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch("/api/experiments", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) { setError(String(json.error ?? "save_failed")); return false }
      upsert(json.experiment as Experiment)
      onSaved?.()
      return true
    } catch {
      setError("save_failed")
      return false
    } finally {
      setBusy(false)
    }
  }

  async function save() {
    if (!draft || problem) return
    if (await call("PUT", draft)) setDraft(null)
  }

  async function setStatus(e: Experiment, status: "running" | "stopped") {
    const msg = status === "running"
      ? `Start “${e.name || e.key}”? Its variants are locked once it runs.`
      : `Stop “${e.name || e.key}”? A stopped experiment can't be restarted.`
    if (!confirm(msg)) return
    await call("POST", { key: e.key, status })
  }

  const offeringName = (id: string) => offerings.find((o) => o.id === id)?.display_name ?? "unknown offering"

  return (
    <div className="flex flex-col gap-6" data-testid="experiments-editor">
      {offerings.length < 1 && (
        <p className="text-sm text-warning-700">No active offerings yet — each variant shows one. Set them up on <Link href="/products" className="font-medium text-brand-700 underline">Products</Link>.</p>
      )}

      {shownError && <p className="text-sm text-danger-700" role="alert" data-testid="experiment-error">{experimentErrorMessage(shownError)}</p>}

      {draft ? (
        <Card>
          <CardHeader title={isNew ? "New experiment" : `Edit ${draft.key}`} subtitle="2–4 variants. The first is the control; weights split devices proportionally." />
          <CardBody className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-ink-700 dark:text-ink-200">Key</span>
                <input className="input" maxLength={48} value={draft.key} disabled={!isNew} placeholder="annual-price-test"
                  onChange={(e) => edit({ key: e.target.value })} data-testid="experiment-key" />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium text-ink-700 dark:text-ink-200">Name</span>
                <input className="input" maxLength={100} value={draft.name} onChange={(e) => edit({ name: e.target.value })} data-testid="experiment-name" />
              </label>
            </div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold uppercase tracking-wide text-ink-500">
                  <th className="py-2 pr-3">Variant key</th>
                  <th className="w-24 py-2 pr-3">Weight</th>
                  <th className="py-2 pr-3">Offering</th>
                  <th className="py-2 pr-3">Pre-selected plan</th>
                  <th className="py-2 pr-3">Exit offer</th>
                  <th className="py-2 pr-3">Design</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {draft.variants.map((v, i) => (
                  <tr key={i}>
                    <td className="py-1.5 pr-3">
                      <input className="input" maxLength={32} value={v.key} onChange={(e) => editVariant(i, { key: e.target.value })} aria-label={`Variant ${i + 1} key`} />
                    </td>
                    <td className="py-1.5 pr-3">
                      <input className="input w-20" type="number" min={1} max={100} value={v.weight}
                        onChange={(e) => editVariant(i, { weight: Number(e.target.value) })} aria-label={`Variant ${i + 1} weight`} />
                    </td>
                    <td className="py-1.5 pr-3">
                      <select className="input w-full" value={v.offering_id} onChange={(e) => editVariant(i, { offering_id: e.target.value, default_sku: undefined })} aria-label={`Variant ${i + 1} offering`}>
                        <option value="">Pick an offering…</option>
                        {offerings.map((o) => <option key={o.id} value={o.id}>{o.display_name} ({o.identifier})</option>)}
                      </select>
                    </td>
                    <td className="py-1.5 pr-3">
                      <select className="input w-full" value={v.default_sku ?? ""} aria-label={`Variant ${i + 1} pre-selected plan`}
                        onChange={(e) => editVariant(i, { default_sku: e.target.value || undefined })}>
                        <option value="">Paywall default</option>
                        {plansOf(v.offering_id).map((p) => <option key={p.sku} value={p.sku}>{p.display_name} ({p.sku})</option>)}
                        {v.default_sku && !plansOf(v.offering_id).some((p) => p.sku === v.default_sku) && (
                          <option value={v.default_sku}>{v.default_sku} (not sold by this offering)</option>
                        )}
                      </select>
                    </td>
                    <td className="py-1.5 pr-3">
                      <select className="input w-full" value={exitChoice(v)} aria-label={`Variant ${i + 1} exit offer`}
                        onChange={(e) => editVariant(i, exitPatch(e.target.value))}>
                        <option value="">Your exit offer</option>
                        <option value="off">Off</option>
                        {coupons.map((c) => <option key={c.id} value={c.id}>{c.code} — {couponTerm(c)}</option>)}
                      </select>
                    </td>
                    <td className="py-1.5 pr-3">
                      <select className="input w-full" value={v.paywall_template ?? ""} aria-label={`Variant ${i + 1} design`}
                        onChange={(e) => editVariant(i, { paywall_template: e.target.value || undefined })}>
                        <option value="">Your paywall</option>
                        {PAYWALL_TEMPLATES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                    </td>
                    <td className="py-1.5">
                      <Button type="button" variant="ghost" size="sm" disabled={draft.variants.length <= 2} aria-label={`Remove variant ${i + 1}`}
                        onClick={() => edit({ variants: draft.variants.filter((_, j) => j !== i) })}><Trash2 className="h-4 w-4" /></Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="secondary" size="sm" disabled={draft.variants.length >= 4} leading={<Plus className="h-4 w-4" />}
                onClick={() => edit({ variants: [...draft.variants, { key: `variant-${String.fromCharCode(97 + draft.variants.length)}`, weight: 50, offering_id: offerings[0]?.id ?? "" }] })}>
                Add variant
              </Button>
              <span className="flex-1" />
              <Button type="button" variant="ghost" onClick={() => { setDraft(null); setError(null) }}>Cancel</Button>
              <Button type="button" onClick={save} loading={busy} disabled={!!problem} data-testid="experiment-save">Save draft</Button>
            </div>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Start from a template" subtitle="The tests subscription apps run first. Every arm keeps your exit offer on unless the test is about it." />
          <CardBody className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" data-testid="experiment-templates">
            {EXPERIMENT_TEMPLATES.map((t) => {
              const needs = t.needs(templateCtx)
              return (
                <div key={t.id} className="flex flex-col gap-2 rounded-lg border border-ink-200 p-4 dark:border-ink-700">
                  <p className="flex items-center gap-2 text-sm font-semibold"><FlaskConical className="h-4 w-4 text-brand-600" />{t.name}</p>
                  <p className="flex-1 text-xs text-ink-500">{t.question}</p>
                  {needs && <p className="text-xs text-warning-700">{needs}</p>}
                  <Button type="button" size="sm" variant="secondary" disabled={!!needs} onClick={() => applyTemplate(t.id)}
                    data-testid={`template-${t.id}`}>Use template</Button>
                </div>
              )
            })}
          </CardBody>
          <div className="border-t border-ink-100 px-5 py-3 dark:border-ink-800">
            <Button type="button" variant="ghost" size="sm" onClick={startNew} leading={<Plus className="h-4 w-4" />} data-testid="experiment-new">Blank experiment</Button>
          </div>
        </Card>
      )}

      {list.length === 0 && !draft && <p className="text-sm text-ink-500">No experiments yet.</p>}

      {list.map((e) => (
        <Card key={e.key}>
          <CardHeader
            title={e.name || e.key}
            subtitle={<span><code>{e.key}</code>{e.started_at && ` · started ${new Date(e.started_at).toLocaleString()}`}{e.stopped_at && ` · stopped ${new Date(e.stopped_at).toLocaleString()}`}</span>}
            action={
              <div className="flex items-center gap-2">
                <Badge tone={STATUS_TONE[e.status]} dot>{e.status}</Badge>
                {e.status === "draft" && (
                  <>
                    <Button type="button" variant="secondary" size="sm" disabled={busy}
                      onClick={() => { setDraft({ key: e.key, name: e.name, variants: e.variants }); setIsNew(false); setError(null) }}>Edit</Button>
                    <Button type="button" size="sm" disabled={busy} onClick={() => setStatus(e, "running")} data-testid={`start-${e.key}`}>Start</Button>
                  </>
                )}
                {e.status === "running" && (
                  <Button type="button" variant="danger" size="sm" disabled={busy} onClick={() => setStatus(e, "stopped")} data-testid={`stop-${e.key}`}>Stop</Button>
                )}
              </div>
            }
          />
          <ul className="flex flex-wrap gap-x-5 gap-y-1 px-5 pb-3 text-xs text-ink-500">
            {e.variants.map((v) => (
              <li key={v.key}>
                <code>{v.key}</code> · {v.weight} · {offeringName(v.offering_id)}
                {v.default_sku && <> · opens on <code>{v.default_sku}</code></>}
                {v.exit_offer === false && <> · no exit offer</>}
                {v.exit_offer_coupon_id && <> · exit offer {coupons.find((c) => c.id === v.exit_offer_coupon_id)?.code ?? "coupon"}</>}
                {v.paywall_template && <> · design {v.paywall_template}</>}
              </li>
            ))}
          </ul>
          {e.status !== "draft" && <Results experimentKey={e.key} canPromote={!busy} onPromote={(variant) => promote(e, variant)} />}
        </Card>
      ))}
    </div>
  )
}
