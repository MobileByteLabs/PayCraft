"use client"

// Paywall ▸ Experiments (migrations 206, 221). A/B tests of which offering the paywall sells and which plan it
// pre-selects: create / edit a draft, start
// it, stop it, read its results. Saved through /api/experiments; the RPCs own the rules, lib/experiments mirrors them.

import { useEffect, useState } from "react"
import Link from "next/link"
import { Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardBody, CardHeader } from "@/components/ui/card"
import {
  type Experiment,
  type ExperimentDraft,
  type ResultRow,
  experimentErrorMessage,
  significance,
  uplift,
  validateExperiment,
} from "@/lib/experiments"

/** [plans]: the offering's active plans — a variant may pre-select one of them (221). */
export type EditorOffering = { id: string; identifier: string; display_name: string; plans?: { sku: string; display_name: string }[] }

const STATUS_TONE = { draft: "neutral", running: "success", stopped: "info" } as const
const pct = (x: number) => `${(x * 100).toFixed(2)}%`

function Results({ experimentKey }: { experimentKey: string }) {
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
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm" data-testid={`results-${experimentKey}`}>
        <thead>
          <tr className="border-b border-ink-100 text-left text-xs font-semibold uppercase tracking-wide text-ink-500 dark:border-ink-800">
            <th className="px-5 py-2.5">Variant</th>
            <th className="px-3 py-2.5 text-right">Viewers</th>
            <th className="px-3 py-2.5 text-right">Checkouts</th>
            <th className="px-3 py-2.5 text-right">Buyers</th>
            <th className="px-3 py-2.5 text-right">Conversion</th>
            <th className="px-3 py-2.5 text-right">Uplift vs control</th>
            <th className="px-5 py-2.5">Significance</th>
          </tr>
        </thead>
        <tbody className="tabular-nums">
          {rows.map((r, i) => {
            const up = i === 0 ? null : uplift(Number(control.conversion), Number(r.conversion))
            const sig = i === 0 ? null : significance(control, r)
            return (
              <tr key={r.variant} className="border-b border-ink-100 last:border-0 dark:border-ink-800">
                <td className="px-5 py-2.5 font-medium"><code>{r.variant}</code>{i === 0 && <span className="ml-2 text-xs text-ink-400">control</span>}</td>
                <td className="px-3 py-2.5 text-right">{r.viewers}</td>
                <td className="px-3 py-2.5 text-right">{r.checkouts}</td>
                <td className="px-3 py-2.5 text-right">{r.buyers}</td>
                <td className="px-3 py-2.5 text-right">{pct(Number(r.conversion))}</td>
                <td className="px-3 py-2.5 text-right">{i === 0 ? "—" : up === null ? "n/a" : `${up >= 0 ? "+" : ""}${(up * 100).toFixed(1)}%`}</td>
                <td className="px-5 py-2.5">
                  {sig && (sig.significant
                    ? <Badge tone="success">Significant · p={sig.p!.toFixed(3)}</Badge>
                    : <Badge tone="neutral">{sig.p === null ? "No data" : `Not yet · p=${sig.p.toFixed(3)}`}</Badge>)}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <p className="border-t border-ink-100 px-5 py-2 text-xs text-ink-500 dark:border-ink-800">
        Distinct devices, live mode only. Significant = two-proportion z-test p &lt; 0.05 with at least 100 viewers in each arm.
      </p>
    </div>
  )
}

export function ExperimentsEditor({
  initial,
  offerings,
  onSaved,
}: {
  initial: Experiment[]
  offerings: EditorOffering[]
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
        <div><Button type="button" onClick={startNew} leading={<Plus className="h-4 w-4" />} data-testid="experiment-new">New experiment</Button></div>
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
            {e.variants.map((v) => <li key={v.key}><code>{v.key}</code> · {v.weight} · {offeringName(v.offering_id)}{v.default_sku && <> · opens on <code>{v.default_sku}</code></>}</li>)}
          </ul>
          {e.status !== "draft" && <Results experimentKey={e.key} />}
        </Card>
      ))}
    </div>
  )
}
