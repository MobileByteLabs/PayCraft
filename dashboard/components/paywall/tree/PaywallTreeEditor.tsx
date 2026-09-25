"use client"

import React, { useMemo, useState } from "react"
import { PaywallTreeRenderer } from "./TreeRenderer"
import { PropertiesPanel } from "./PropertiesPanel"
import { defaultSelectedRole, parseWorkflow } from "./parse"
import {
  Json,
  NODE_PALETTE,
  clone,
  insertNode,
  layerRows,
  moveNode,
  navigationTargets,
  patchNode,
  removeNode,
  setLocalizedText,
  stepRoot,
  stepRows,
} from "./edit"
import type { PackagePrice } from "./types"

/**
 * Layer tree · live preview · properties — the editor RevenueCat's designer is shaped like, over
 * the same component tree the SDK renders (D16).
 *
 * ## One document, three views
 * The layer tree, the preview and the properties panel all address nodes by the SAME path string,
 * so selecting in one selects in the others without any synchronisation code. The document itself
 * is raw JSON (see edit.ts); the parsed model exists only to draw the preview and is rebuilt after
 * every edit. That is a little wasteful and completely predictable — the preview cannot drift from
 * what will be saved, because it is derived from what will be saved.
 *
 * ## Saving and publishing are different buttons
 * Save writes the draft. Publish is the one action that reaches a customer's device, so it is never
 * implicit, never a flag on save, and always states what it is about to do.
 */

export interface PaywallTreeEditorProps {
  /** The tenant's draft tree, or a seed to start from. */
  initialWorkflow: Json
  /** Real catalogue prices when known; the preview falls back to samples for an empty catalogue. */
  prices?: Record<string, PackagePrice>
  initialRevision: number | null
  publishedRevision: number | null
}

const SAMPLE: Record<string, PackagePrice> = {
  $rc_annual: { display: "$41.99", perPeriodNote: "$3.49 / mo billed annually", savingsPercent: 50 },
  $rc_monthly: { display: "$6.99", perPeriodNote: null, savingsPercent: null },
}

export function PaywallTreeEditor({
  initialWorkflow,
  prices,
  initialRevision,
  publishedRevision,
}: PaywallTreeEditorProps) {
  const [doc, setDoc] = useState<Json>(() => clone(initialWorkflow))
  const [selected, setSelected] = useState<string | null>("0")
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState<"save" | "publish" | null>(null)
  const [revision, setRevision] = useState<number | null>(initialRevision)
  const [live, setLive] = useState<number | null>(publishedRevision)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [editingStep, setEditingStep] = useState<string | null>(null)

  const locale = useMemo(() => {
    const locs = doc.localizations as Record<string, unknown> | undefined
    return locs ? Object.keys(locs)[0] ?? "en_US" : "en_US"
  }, [doc])

  const localizations = useMemo(() => {
    const locs = doc.localizations as Record<string, Record<string, string>> | undefined
    return locs?.[locale] ?? {}
  }, [doc, locale])

  const steps = useMemo(() => stepRows(doc), [doc])
  const activeStep = editingStep ?? (doc.initial_step_id as string | undefined) ?? steps[0]?.id
  const root = useMemo(() => stepRoot(doc, activeStep), [doc, activeStep])
  const workflow = useMemo(() => parseWorkflow(doc), [doc])
  const rows = useMemo(() => (root ? layerRows(root, localizations) : []), [root, localizations])

  // Every structural edit replaces the step root inside the document, so the document stays the
  // single thing that gets saved — there is no second copy to keep in step.
  function replaceRoot(next: Json) {
    setDoc((prev) => {
      const copy = clone(prev)
      const steps = Array.isArray(copy.steps) ? (copy.steps as Json[]) : []
      // Write back to the step being EDITED. Keyed on initial_step_id, editing step 2 of a
      // multi-step paywall silently overwrote step 1.
      const idx = Math.max(
        0,
        steps.findIndex((s) => s.id === activeStep),
      )
      if (steps[idx]) steps[idx].components_config = next
      return copy
    })
    setDirty(true)
  }

  function handlePatch(path: string, patch: Json) {
    if (!root) return
    replaceRoot(patchNode(root, path, patch))
  }
  function handleRemove(path: string) {
    if (!root) return
    replaceRoot(removeNode(root, path))
    setSelected(null)
  }
  function handleMove(path: string, delta: number) {
    if (!root) return
    replaceRoot(moveNode(root, path, delta))
  }
  function handleAdd(make: () => Json) {
    if (!root) return
    const target = selected ?? "0"
    replaceRoot(insertNode(root, target, make(), target === "0"))
    setAddOpen(false)
  }
  function handleCopyChange(lid: string, value: string) {
    setDoc((prev) => setLocalizedText(prev, locale, lid, value))
    setDirty(true)
  }

  async function save() {
    setBusy("save")
    setError(null)
    setNotice(null)
    try {
      const res = await fetch("/api/paywall/workflow", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ workflow: doc }),
      })
      const json = (await res.json()) as { error?: string; revision?: number }
      if (!res.ok) throw new Error(json.error ?? `save failed (${res.status})`)
      setRevision(json.revision ?? null)
      setDirty(false)
      setNotice(`Draft saved as revision ${json.revision}. Not live yet.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  async function publish() {
    setBusy("publish")
    setError(null)
    setNotice(null)
    try {
      const res = await fetch("/api/paywall/workflow", { method: "POST" })
      const json = (await res.json()) as { error?: string; published_revision?: number }
      if (!res.ok) throw new Error(json.error ?? `publish failed (${res.status})`)
      setLive(json.published_revision ?? null)
      setNotice(`Published revision ${json.published_revision}. Devices pick it up within the SDK cache TTL.`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  if (!root || !workflow) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
        This paywall has no component tree yet. Pick one from{" "}
        <a className="underline" href="/paywall/templates">
          the template gallery
        </a>{" "}
        to start.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={busy !== null || !dirty}
          onClick={save}
          className="rounded-md bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
        >
          {busy === "save" ? "Saving…" : dirty ? "Save draft" : "Saved"}
        </button>
        <button
          type="button"
          disabled={busy !== null || dirty}
          onClick={publish}
          title={dirty ? "Save your draft before publishing it" : "Make this draft live"}
          className="rounded-md border border-ink-300 px-3 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-50 disabled:opacity-50 dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800"
        >
          {busy === "publish" ? "Publishing…" : "Publish"}
        </button>
        <span className="text-xs text-ink-500">
          draft r{revision ?? "—"} · live r{live ?? "none"}
          {dirty && " · unsaved changes"}
        </span>
      </div>

      {notice && (
        <div role="status" className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">
          {notice}
        </div>
      )}
      {error && (
        <div role="alert" className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      )}

      <div className="flex min-h-[640px] overflow-hidden rounded-xl border border-ink-200 dark:border-ink-800">
        {/* Layer tree */}
        <div className="w-64 shrink-0 overflow-y-auto border-r border-ink-200 dark:border-ink-800">
          {steps.length > 1 && (
            // Only shown for a multi-step paywall: one step needs no switcher, and a control that
            // does nothing is worse than no control.
            <div className="border-b border-ink-200 px-3 py-2 dark:border-ink-800">
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-500">
                Steps
              </div>
              <div className="flex flex-wrap gap-1">
                {steps.map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setEditingStep(s.id)
                      setSelected("0")
                    }}
                    className={`rounded px-2 py-0.5 text-xs ${
                      s.id === activeStep
                        ? "bg-violet-600 text-white"
                        : "border border-ink-300 text-ink-600 hover:bg-ink-100 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800"
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2 dark:border-ink-800">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-500">Layers</span>
            <div className="relative">
              <button
                type="button"
                className="rounded border border-ink-300 px-2 py-0.5 text-xs text-ink-600 hover:bg-ink-100 dark:border-ink-700 dark:text-ink-300 dark:hover:bg-ink-800"
                onClick={() => setAddOpen((v) => !v)}
              >
                + Add
              </button>
              {addOpen && (
                <div className="absolute right-0 z-10 mt-1 w-44 rounded-md border border-ink-200 bg-white py-1 shadow-lg dark:border-ink-700 dark:bg-ink-900">
                  {NODE_PALETTE.map((entry) => (
                    <button
                      key={entry.type}
                      type="button"
                      className="block w-full px-3 py-1.5 text-left text-sm hover:bg-ink-100 dark:hover:bg-ink-800"
                      onClick={() => handleAdd(entry.make)}
                    >
                      {entry.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
          <ul className="py-1">
            {rows.map((r) => (
              <li key={r.path}>
                <button
                  type="button"
                  onClick={() => setSelected(r.path)}
                  className={`flex w-full items-center gap-2 px-3 py-1 text-left text-sm ${
                    selected === r.path
                      ? "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-100"
                      : "hover:bg-ink-100 dark:hover:bg-ink-800"
                  }`}
                  style={{ paddingLeft: 12 + r.depth * 12 }}
                >
                  <span className="w-14 shrink-0 truncate font-mono text-[10px] uppercase text-ink-400">
                    {r.type}
                  </span>
                  <span className="truncate">{r.label}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        {/* Preview */}
        <div className="flex flex-1 justify-center overflow-y-auto bg-ink-100 p-6 dark:bg-ink-950">
          <div
            style={{
              width: 380,
              borderRadius: 20,
              overflow: "hidden",
              boxShadow: "0 8px 30px rgba(0,0,0,.14)",
              alignSelf: "flex-start",
            }}
          >
            <PaywallTreeRenderer
              workflow={workflow}
              context={{
                locale,
                hasIntroOffer: false,
                selectedPackageRole: defaultSelectedRole(workflow),
              }}
              priceFor={(role) => prices?.[role] ?? SAMPLE[role] ?? null}
              stepId={activeStep}
              selectedNodePath={selected}
              onSelectNode={setSelected}
            />
          </div>
        </div>

        <PropertiesPanel
          root={root}
          path={selected}
          locale={locale}
          localizations={localizations}
          onPatch={handlePatch}
          onCopyChange={handleCopyChange}
          onRemove={handleRemove}
          onMove={handleMove}
          stepOptions={navigationTargets(doc, activeStep ?? "")}
        />
      </div>
    </div>
  )
}
