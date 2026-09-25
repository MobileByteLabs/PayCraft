"use client"

import React, { useMemo, useState } from "react"
import { PaywallTreeRenderer } from "./tree/TreeRenderer"
import { parseWorkflow, defaultSelectedRole } from "./tree/parse"
import type { PackagePrice, PaywallWorkflow } from "./tree/types"

export interface GalleryTemplate {
  slug: string
  name: string
  description: string | null
  category: string
  sort_order: number
  schema_version: number
  workflow: unknown
}

interface Props {
  templates: GalleryTemplate[]
  /** True when the tenant already has a tree — the only case where "update" is meaningful. */
  hasExistingTree: boolean
  currentRevision: number | null
}

/**
 * Sample prices for the previews.
 *
 * Real catalogue prices would be better and are deliberately NOT used: the gallery is browsed
 * before a tenant has necessarily published products, and a preview that renders blank prices for
 * a new tenant reads as a broken template rather than an empty catalogue. Fixed sample values make
 * every card comparable, which is what a gallery is for.
 */
const SAMPLE: Record<string, PackagePrice> = {
  $rc_annual: { display: "$41.99", perPeriodNote: "$3.49 / mo billed annually", savingsPercent: 50 },
  $rc_monthly: { display: "$6.99", perPeriodNote: null, savingsPercent: null },
}

type Applying = { slug: string; mode: "create" | "update" } | null

export function TemplateGallery({ templates, hasExistingTree, currentRevision }: Props) {
  const [applying, setApplying] = useState<Applying>(null)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<Applying>(null)

  const parsed = useMemo(
    () =>
      templates.map((t) => ({
        meta: t,
        workflow: parseWorkflow(t.workflow as object),
      })),
    [templates],
  )

  async function apply(slug: string, mode: "create" | "update") {
    setApplying({ slug, mode })
    setError(null)
    setResult(null)
    try {
      const res = await fetch("/api/paywall/templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug, mode }),
      })
      const json = (await res.json()) as {
        error?: string
        revision?: number
        preserved_strings?: number
      }
      if (!res.ok) throw new Error(json.error ?? `request failed (${res.status})`)
      setResult(
        mode === "update"
          ? `Applied ${slug} — kept ${json.preserved_strings ?? 0} of your strings. Draft is now revision ${json.revision}.`
          : `Applied ${slug} as a fresh draft (revision ${json.revision}). Your previous copy was replaced.`,
      )
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setApplying(null)
      setConfirm(null)
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-ink-200 bg-ink-50 px-4 py-3 text-sm text-ink-600 dark:border-ink-800 dark:bg-ink-900/40 dark:text-ink-400">
        Applying a template writes your <strong>draft</strong>. Nothing reaches a customer&apos;s
        device until you publish.
        {currentRevision !== null && (
          <> Current draft revision: <strong>{currentRevision}</strong>.</>
        )}
      </div>

      {result && (
        <div
          role="status"
          className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200"
        >
          {result}
        </div>
      )}
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200"
        >
          {error}
        </div>
      )}

      <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
        {parsed.map(({ meta, workflow }) => (
          <TemplateCard
            key={meta.slug}
            meta={meta}
            workflow={workflow}
            hasExistingTree={hasExistingTree}
            busy={applying?.slug === meta.slug}
            onApply={(mode) =>
              mode === "create" && hasExistingTree
                ? setConfirm({ slug: meta.slug, mode })
                : apply(meta.slug, mode)
            }
          />
        ))}
      </div>

      {confirm && (
        // "Create" over an existing tree throws authored copy away. That is a legitimate thing to
        // want and a terrible thing to do by accident, so it is the one action behind a confirm.
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-w-md rounded-xl bg-white p-6 shadow-xl dark:bg-ink-900">
            <h3 className="text-lg font-semibold">Replace your paywall copy?</h3>
            <p className="mt-2 text-sm text-ink-600 dark:text-ink-400">
              Starting fresh from <strong>{confirm.slug}</strong> discards the wording and
              translations in your current draft. Choose{" "}
              <strong>Update from this template</strong> instead to take the new layout and keep
              your copy.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md px-3 py-2 text-sm font-medium text-ink-600 hover:bg-ink-100 dark:text-ink-300 dark:hover:bg-ink-800"
                onClick={() => setConfirm(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md bg-red-600 px-3 py-2 text-sm font-semibold text-white hover:bg-red-700"
                onClick={() => apply(confirm.slug, "create")}
              >
                Replace copy
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TemplateCard({
  meta,
  workflow,
  hasExistingTree,
  busy,
  onApply,
}: {
  meta: GalleryTemplate
  workflow: PaywallWorkflow | null
  hasExistingTree: boolean
  busy: boolean
  onApply: (mode: "create" | "update") => void
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-ink-200 bg-white dark:border-ink-800 dark:bg-ink-900">
      <div className="flex h-[420px] items-start justify-center overflow-hidden bg-ink-100 p-4 dark:bg-ink-950">
        {workflow ? (
          // Scaled, not screenshotted: the preview is the same tree the SDK renders, so it cannot
          // go stale the way a captured image does.
          <div
            style={{
              width: 340,
              transform: "scale(0.78)",
              transformOrigin: "top center",
              borderRadius: 18,
              overflow: "hidden",
              boxShadow: "0 6px 24px rgba(0,0,0,.12)",
            }}
          >
            <PaywallTreeRenderer
              workflow={workflow}
              context={{
                locale: Object.keys(workflow.localizations)[0] ?? "en_US",
                hasIntroOffer: false,
                selectedPackageRole: defaultSelectedRole(workflow),
              }}
              priceFor={(role) => SAMPLE[role] ?? null}
            />
          </div>
        ) : (
          <div className="self-center text-sm text-ink-500">
            This template could not be parsed by this dashboard build.
          </div>
        )}
      </div>

      <div className="space-y-3 p-4">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">{meta.name}</h3>
            <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-600 dark:bg-ink-800 dark:text-ink-400">
              {meta.category}
            </span>
          </div>
          {meta.description && (
            <p className="mt-1 text-sm text-ink-600 dark:text-ink-400">{meta.description}</p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={busy || !workflow}
            className="rounded-md bg-violet-600 px-3 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50"
            onClick={() => onApply("create")}
          >
            {busy ? "Applying…" : hasExistingTree ? "Start fresh from this" : "Use this template"}
          </button>
          {hasExistingTree && (
            <button
              type="button"
              disabled={busy || !workflow}
              className="rounded-md border border-ink-300 px-3 py-2 text-sm font-semibold text-ink-700 hover:bg-ink-50 disabled:opacity-50 dark:border-ink-700 dark:text-ink-200 dark:hover:bg-ink-800"
              onClick={() => onApply("update")}
              title="Take this layout, keep your wording and translations"
            >
              Update from this template
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
