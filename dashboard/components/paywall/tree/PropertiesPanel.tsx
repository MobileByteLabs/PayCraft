"use client"

import React from "react"
import { Json, locate } from "./edit"
import { PAYWALL_VARIABLES } from "./variables"

/**
 * The right-hand pane: edit the selected node's properties, and the copy behind its `text_lid`.
 *
 * Copy is edited THROUGH the lid, never as a literal on the node (D13). That indirection is what
 * lets "update from template" replace a layout without discarding the wording, so an editor that
 * wrote strings onto nodes would quietly destroy the feature the gallery depends on.
 */

export interface PropertiesPanelProps {
  root: Json
  path: string | null
  locale: string
  localizations: Record<string, string>
  onPatch: (path: string, patch: Json) => void
  onCopyChange: (lid: string, value: string) => void
  onRemove: (path: string) => void
  onMove: (path: string, delta: number) => void
  /** Steps this button may navigate to — every step except the one it sits on. */
  stepOptions?: Array<{ id: string; name: string }>
}

export function PropertiesPanel({
  root,
  path,
  locale,
  localizations,
  onPatch,
  onCopyChange,
  onRemove,
  onMove,
  stepOptions = [],
}: PropertiesPanelProps) {
  if (!path) {
    return (
      <aside className="w-80 shrink-0 border-l border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">
        Select a layer to edit it.
      </aside>
    )
  }

  const found = locate(root, path)
  if (!found) {
    return (
      <aside className="w-80 shrink-0 border-l border-zinc-200 p-4 text-sm text-zinc-500 dark:border-zinc-800">
        That layer no longer exists.
      </aside>
    )
  }

  const node = found.node
  const type = typeof node.type === "string" ? node.type : "unknown"
  const lid = typeof node.text_lid === "string" ? node.text_lid : null

  return (
    <aside className="w-80 shrink-0 space-y-5 overflow-y-auto border-l border-zinc-200 p-4 dark:border-zinc-800">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-500">{type}</div>
          <div className="font-mono text-[11px] text-zinc-400">{path}</div>
        </div>
        <div className="flex gap-1">
          <IconBtn title="Move up" onClick={() => onMove(path, -1)}>↑</IconBtn>
          <IconBtn title="Move down" onClick={() => onMove(path, 1)}>↓</IconBtn>
          {path !== "0" && (
            <IconBtn title="Delete layer" danger onClick={() => onRemove(path)}>✕</IconBtn>
          )}
        </div>
      </header>

      {lid !== null && (
        <Section title="Copy">
          <label className="block text-xs text-zinc-500">
            {locale} · <span className="font-mono">{lid}</span>
          </label>
          <textarea
            className="mt-1 w-full rounded-md border border-zinc-300 p-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
            rows={3}
            value={localizations[lid] ?? ""}
            onChange={(e) => onCopyChange(lid, e.target.value)}
          />
          <div className="mt-2 flex flex-wrap gap-1">
            {PAYWALL_VARIABLES.map((v) => (
              <button
                key={v}
                type="button"
                title={`Insert {{ ${v} }}`}
                className="rounded border border-zinc-300 px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                onClick={() => onCopyChange(lid, `${localizations[lid] ?? ""}{{ ${v} }}`)}
              >
                {v.replace("product.", "")}
              </button>
            ))}
          </div>
          <p className="mt-1 text-[11px] leading-snug text-zinc-500">
            Variables resolve against the plan this text sits inside. A variable with nothing to
            show renders as nothing — and takes its chip with it.
          </p>
        </Section>
      )}

      {type === "text" && (
        <Section title="Type">
          <NumberField label="Size" value={num(node.font_size, 14)} onChange={(v) => onPatch(path, { font_size: v })} />
          <SelectField
            label="Weight"
            value={String(num(node.font_weight_int, 400))}
            options={[["400", "Regular"], ["600", "Semibold"], ["700", "Bold"], ["800", "Extra bold"]]}
            onChange={(v) => onPatch(path, { font_weight_int: Number(v) })}
          />
          <SelectField
            label="Align"
            value={str(node.horizontal_alignment, "leading")}
            options={[["leading", "Left"], ["center", "Center"], ["trailing", "Right"]]}
            onChange={(v) => onPatch(path, { horizontal_alignment: v })}
          />
        </Section>
      )}

      {type === "stack" && (
        <Section title="Layout">
          <SelectField
            label="Direction"
            value={str(node.dimension, "vertical")}
            options={[["vertical", "Column"], ["horizontal", "Row"], ["zlayer", "Layers"]]}
            onChange={(v) => onPatch(path, { dimension: v })}
          />
          <NumberField label="Spacing" value={num(node.spacing, 0)} onChange={(v) => onPatch(path, { spacing: v })} />
          <SelectField
            label="Align"
            value={str(node.horizontal_alignment, "leading")}
            options={[["leading", "Left"], ["center", "Center"], ["trailing", "Right"]]}
            onChange={(v) => onPatch(path, { horizontal_alignment: v })}
          />
          <NumberField
            label="Corner radius"
            value={num((node.shape as Json | undefined)?.radius, 0)}
            onChange={(v) => onPatch(path, { shape: { radius: v } })}
          />
        </Section>
      )}

      {type === "spacer" && (
        <Section title="Space">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={node.grow === true}
              onChange={(e) => onPatch(path, { grow: e.target.checked })}
            />
            Flexible — absorb the leftover space of its row
          </label>
          {node.grow !== true && (
            <NumberField label="Size" value={num(node.size, 8)} onChange={(v) => onPatch(path, { size: v })} />
          )}
        </Section>
      )}

      {type === "button" && (
        <Section title="Action">
          <SelectField
            label="On tap"
            value={buttonActionKind(node)}
            options={[["navigate_to", "Go to step"], ["purchase", "Start checkout"], ["restore", "Restore purchases"]]}
            onChange={(v) =>
              onPatch(path, {
                action:
                  v === "navigate_to"
                    ? { type: "navigate_to", destination: stepOptions[0]?.id ?? "" }
                    : { type: v },
                navigate_to: undefined,
              })
            }
          />
          {buttonActionKind(node) === "navigate_to" && (
            <SelectField
              label="Destination"
              value={buttonDestination(node)}
              options={stepOptions.map((s) => [s.id, s.name] as [string, string])}
              onChange={(v) => onPatch(path, { action: { type: "navigate_to", destination: v } })}
            />
          )}
          {buttonActionKind(node) === "navigate_to" && stepOptions.length === 0 && (
            <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-400">
              This paywall has only one step, so there is nowhere to navigate. A button pointing at
              nothing renders as nothing on a device — add a step, or choose another action.
            </p>
          )}
        </Section>
      )}

      {type === "package" && (
        <Section title="Plan">
          <TextField
            label="Package role"
            value={str(node.package_id, "")}
            onChange={(v) => onPatch(path, { package_id: v })}
          />
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={node.is_selected_by_default === true}
              onChange={(e) => onPatch(path, { is_selected_by_default: e.target.checked })}
            />
            Selected by default
          </label>
          <p className="mt-1 text-[11px] leading-snug text-zinc-500">
            Bind to a ROLE (<span className="font-mono">$rc_annual</span>), never a store SKU — a
            role survives price changes and works on every platform.
          </p>
        </Section>
      )}

      {type === "unknown" && (
        <p className="text-sm text-zinc-500">
          This dashboard build does not know this node type. It is preserved untouched — editing
          around it is safe, and it will render correctly on an SDK that understands it.
        </p>
      )}
    </aside>
  )
}

function buttonActionKind(node: Json): string {
  const shorthand = node["navigate_to"]
  if (typeof shorthand === "string" && shorthand) return "navigate_to"
  const a = node["action"]
  if (a && typeof a === "object" && !Array.isArray(a)) {
    const t = (a as Record<string, unknown>)["type"]
    if (typeof t === "string") return t
  }
  return "purchase"
}

function buttonDestination(node: Json): string {
  const shorthand = node["navigate_to"]
  if (typeof shorthand === "string") return shorthand
  const a = node["action"]
  if (a && typeof a === "object" && !Array.isArray(a)) {
    const d = (a as Record<string, unknown>)["destination"]
    if (typeof d === "string") return d
  }
  return ""
}

function num(v: unknown, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : fallback
}
function str(v: unknown, fallback: string): string {
  return typeof v === "string" ? v : fallback
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{title}</h4>
      {children}
    </section>
  )
}

function IconBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  title: string
  danger?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={`rounded border px-2 py-1 text-xs ${
        danger
          ? "border-red-300 text-red-600 hover:bg-red-50 dark:border-red-900 dark:hover:bg-red-950/40"
          : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
    >
      {children}
    </button>
  )
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  return (
    <label className="block text-xs text-zinc-500">
      {label}
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-1 w-full rounded-md border border-zinc-300 p-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
    </label>
  )
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="block text-xs text-zinc-500">
      {label}
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-zinc-300 p-1.5 font-mono text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      />
    </label>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<[string, string]>
  onChange: (v: string) => void
}) {
  return (
    <label className="block text-xs text-zinc-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full rounded-md border border-zinc-300 p-1.5 text-sm text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      >
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </label>
  )
}
