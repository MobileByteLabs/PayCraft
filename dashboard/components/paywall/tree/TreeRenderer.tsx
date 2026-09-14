"use client"

import React from "react"
import { resolveLid } from "./parse"
import {
  Edges,
  PackagePrice,
  PaywallNode,
  PaywallWorkflow,
  RenderContext,
  StackNode,
} from "./types"
import {
  effectiveProperties,
  pricesItself,
  rendersNothing,
  substituteVariables,
} from "./variables"

/**
 * Renders a component tree the way the SDK renders it.
 *
 * ## Why this replaces a hand-maintained replica
 * `paywall-designer.tsx` draws the paywall with ~650 lines of TSX that imitate the Kotlin templates
 * state by state. Every SDK change had to be re-implemented here by hand, and the preview was only
 * as truthful as whoever last remembered to do it. Driving both from the same tree removes the
 * remembering: the preview is wrong only if the renderer is wrong, and the renderer is the thing
 * tests cover.
 *
 * ## Where it deliberately differs
 * Compose measures; CSS reflows. Rather than emulate Compose's measurement, the layout primitives
 * map onto the CSS with the same SEMANTICS — a vertical stack is a column flexbox with `gap`, a
 * `grow` spacer is `flex: 1`, `fillMaxWidth` text is `width: 100%`. Where the two cannot agree the
 * tree is the arbiter, and `tree-parity.test.ts` pins the decisions that matter (which nodes draw,
 * what copy they carry) rather than pixel geometry, which will never match and should not.
 */

function px(n: number): string {
  return `${n}px`
}

function paddingCss(e: Edges): string {
  return `${px(e.top)} ${px(e.trailing)} ${px(e.bottom)} ${px(e.leading)}`
}

/**
 * Tree colours are CSS-ordered already (`#RRGGBBAA`) — the SDK converts because ITS reader expects
 * `#AARRGGBB`; the web is where the format came from, so it passes straight through.
 */
/**
 * Design tokens (D11), then literal hex.
 *
 * Mirrors `treeTokenColorOrNull` in the SDK. A built-in seed names `accent` rather than a hex so the
 * same tree is on-brand in every consumer app; the preview resolves those against PayCraft's own
 * palette, which is the right stand-in when the dashboard is showing a template rather than a
 * particular tenant's running app.
 */
const COLOR_TOKENS: Record<string, string> = {
  accent: "#6C4FC7",
  accent_soft: "rgba(108,79,199,0.10)",
  on_accent: "#FFFFFF",
  surface: "#FFFFFF",
  on_surface: "#141414",
  on_surface_variant: "#5F5F6B",
}

function color(hex: string | null | undefined): string | undefined {
  if (!hex) return undefined
  const raw = hex.trim()
  const token = COLOR_TOKENS[raw.toLowerCase()]
  if (token) return token
  return raw.startsWith("#") ? raw : `#${raw}`
}

export interface TreeRendererProps {
  workflow: PaywallWorkflow
  context: RenderContext
  priceFor?: (role: string) => PackagePrice | null
  onSelectPackage?: (role: string) => void
  onPurchase?: () => void
  onRestore?: () => void
  /** Highlights one node — the layer tree's selection, drawn only in the editor. */
  selectedNodePath?: string | null
  onSelectNode?: (path: string) => void
  stepId?: string
}

export function PaywallTreeRenderer({
  workflow,
  context,
  priceFor,
  onSelectPackage,
  onPurchase,
  onRestore,
  selectedNodePath,
  onSelectNode,
  stepId,
}: TreeRendererProps) {
  // Which step is on screen. The editor pins one via `stepId`; the standalone preview starts at
  // the initial step and follows `navigate_to` buttons, so a multi-step tree is walkable here
  // exactly as it is on a device (D15).
  const [activeStep, setActiveStep] = React.useState<string | null>(null)
  const currentId = stepId ?? activeStep ?? workflow.initialStepId
  const step = workflow.steps.find((s) => s.id === currentId) ?? workflow.steps[0]
  if (!step?.root) return null

  const navigate = (target: string) => {
    // A dangling destination is ignored rather than blanking the preview — same rule as the SDK.
    if (workflow.steps.some((s) => s.id === target)) setActiveStep(target)
  }

  const dark = workflow.colorScheme === "dark"
  const surface = dark ? "#121212" : "#FFFFFF"
  const onSurface = dark ? "#F2F2F2" : "#141414"
  const onSurfaceVariant = dark ? "#B8B8B8" : "#5F5F6B"

  return (
    <div
      style={{
        background: surface,
        color: onSurface,
        minHeight: "100%",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <RenderNode
        node={step.root}
        path="0"
        workflow={workflow}
        context={context}
        onSurface={onSurface}
        onSurfaceVariant={onSurfaceVariant}
        owningPackageRole={null}
        priceFor={priceFor}
        onSelectPackage={onSelectPackage}
        onPurchase={onPurchase}
        onRestore={onRestore}
        onNavigate={navigate}
        selectedNodePath={selectedNodePath}
        onSelectNode={onSelectNode}
        parentAxis="vertical"
        grow={false}
      />
      <div
        style={{
          textAlign: "center",
          fontSize: 11,
          fontWeight: 600,
          color: onSurfaceVariant,
          padding: "12px 0",
        }}
      >
        Powered by PayCraft by MobileByteSensei
      </div>
    </div>
  )
}

interface NodeProps {
  node: PaywallNode
  path: string
  workflow: PaywallWorkflow
  context: RenderContext
  onSurface: string
  onSurfaceVariant: string
  owningPackageRole: string | null
  priceFor?: (role: string) => PackagePrice | null
  onSelectPackage?: (role: string) => void
  onPurchase?: () => void
  onRestore?: () => void
  onNavigate?: (stepId: string) => void
  selectedNodePath?: string | null
  onSelectNode?: (path: string) => void
  parentAxis: "vertical" | "horizontal" | "z"
  grow: boolean
}

function RenderNode(props: NodeProps): React.ReactElement | null {
  const {
    node,
    path,
    workflow,
    context,
    onSurface,
    onSurfaceVariant,
    owningPackageRole,
    priceFor,
    onSelectPackage,
    onPurchase,
    onRestore,
    onNavigate,
    selectedNodePath,
    onSelectNode,
    parentAxis,
    grow,
  } = props

  const price = owningPackageRole ? priceFor?.(owningPackageRole) ?? null : null
  const props_ = effectiveProperties(node, context, owningPackageRole)

  // Skipped WITH its decoration — see rendersNothing. Checked before anything draws so a skipped
  // stack never lays out its children.
  if ((node.kind === "text" || node.kind === "stack") && rendersNothing(node, workflow, context, price)) {
    return null
  }

  const text = (lid: string, key = "text_lid"): string =>
    substituteVariables(resolveLid(workflow, props_[key] ?? lid, context.locale), price)

  // The editor's selection ring. Drawn OUTSIDE the node's own styling (outline, not border) so
  // selecting a node never changes the layout the author is judging.
  const editorRing: React.CSSProperties =
    selectedNodePath === path ? { outline: "2px solid #7C3AED", outlineOffset: 2 } : {}
  const click = onSelectNode
    ? {
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation()
          onSelectNode(path)
        },
      }
    : {}

  switch (node.kind) {
    case "stack": {
      const s = node as StackNode
      const style: React.CSSProperties = {
        display: "flex",
        flexDirection: s.axis === "horizontal" ? "row" : "column",
        gap: px(s.spacing),
        padding: paddingCss(s.padding),
        margin: paddingCss(s.margin),
        background: color(props_["background"] ?? s.backgroundHex),
        borderRadius: s.cornerRadius ? px(s.cornerRadius) : undefined,
        boxSizing: "border-box",
        ...(grow ? { flex: 1 } : {}),
        ...editorRing,
      }
      const borderWidth = Number(props_["border_width"] ?? s.borderWidth) || 0
      const borderColor = color(props_["border"] ?? s.borderHex)
      if (borderColor && borderWidth > 0) style.border = `${px(borderWidth)} solid ${borderColor}`

      if (s.axis === "horizontal") {
        style.alignItems = "center"
      } else if (s.axis === "z") {
        style.position = "relative"
      } else {
        style.width = "100%"
        style.alignItems =
          s.horizontalAlignment === "center"
            ? "center"
            : s.horizontalAlignment === "trailing"
              ? "flex-end"
              : "stretch"
      }

      return (
        <div style={style} {...click}>
          {s.components.map((child, i) => (
            <RenderNode
              key={i}
              {...props}
              node={child}
              path={`${path}.${i}`}
              parentAxis={s.axis}
              grow={child.kind === "spacer" && child.grow}
            />
          ))}
        </div>
      )
    }

    case "text":
      return (
        <div
          style={{
            // In a ROW, full width makes every sibling fight for the line — the defect that
            // rendered a price one character per line in the SDK before parent-axis awareness.
            width: parentAxis === "horizontal" ? undefined : "100%",
            fontSize: px(Number(props_["font_size"] ?? node.fontSize)),
            fontWeight: Number(props_["font_weight_int"] ?? node.fontWeight),
            color: color(props_["color"] ?? node.colorHex) ?? onSurface,
            textAlign:
              node.alignment === "center" ? "center" : node.alignment === "trailing" ? "right" : "left",
            padding: paddingCss(node.padding),
            margin: paddingCss(node.margin),
            whiteSpace: "pre-wrap",
            ...editorRing,
          }}
          {...click}
        >
          {text(node.textLid)}
        </div>
      )

    case "icon":
      return (
        <div
          style={{
            width: px(node.size),
            height: px(node.size),
            borderRadius: px(Math.round(node.size / 4)),
            background: color(node.tintHex) ?? "#EFE9FB",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#6C4FC7",
            fontSize: px(Math.round(node.size / 2)),
            ...editorRing,
          }}
          {...click}
        >
          ★
        </div>
      )

    case "image":
      // Deliberately a placeholder, matching the SDK: `PaywallNode.Image` renders nothing there
      // pending an image-loading decision. Drawing a real image here would make the preview
      // promise something the device does not yet do.
      return node.url ? (
        <div
          style={{
            width: "100%",
            aspectRatio: "16 / 9",
            borderRadius: px(node.cornerRadius),
            background: "repeating-linear-gradient(45deg,#EEE,#EEE 8px,#F7F7F7 8px,#F7F7F7 16px)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            color: "#888",
            ...editorRing,
          }}
          {...click}
        >
          image — not rendered by the SDK yet
        </div>
      ) : null

    case "package": {
      const selfPriced = pricesItself(node.stack, workflow, context)
      const pkgPrice = priceFor?.(node.roleIdentifier) ?? null
      return (
        <div
          style={{ position: "relative", width: "100%", cursor: onSelectPackage ? "pointer" : undefined, ...editorRing }}
          onClick={(e) => {
            e.stopPropagation()
            if (onSelectNode) onSelectNode(path)
            onSelectPackage?.(node.roleIdentifier)
          }}
        >
          <RenderNode
            {...props}
            node={node.stack}
            path={`${path}.stack`}
            owningPackageRole={node.roleIdentifier}
            parentAxis="vertical"
            grow={false}
            onSelectNode={undefined}
          />
          {!selfPriced && pkgPrice && (
            // Legacy fallback, as in the SDK: a tree with no price variable still shows prices.
            <div
              style={{
                position: "absolute",
                top: 12,
                right: 12,
                textAlign: "right",
                display: "flex",
                flexDirection: "column",
                alignItems: "flex-end",
              }}
            >
              {pkgPrice.savingsPercent != null && (
                <span
                  style={{
                    background: "#6C4FC7",
                    color: "#fff",
                    fontSize: 11,
                    fontWeight: 700,
                    borderRadius: 6,
                    padding: "3px 8px",
                  }}
                >
                  SAVE {pkgPrice.savingsPercent}%
                </span>
              )}
              <span style={{ fontSize: 14, fontWeight: 700 }}>{pkgPrice.display}</span>
              {pkgPrice.perPeriodNote && (
                <span style={{ fontSize: 12, color: onSurfaceVariant }}>{pkgPrice.perPeriodNote}</span>
              )}
            </div>
          )}
        </div>
      )
    }

    case "button":
      return (
        <button
          type="button"
          style={{
            width: "100%",
            border: "none",
            borderRadius: 26,
            padding: "14px 20px",
            background: "#6C4FC7",
            color: "#fff",
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
            ...editorRing,
          }}
          onClick={(e) => {
            e.stopPropagation()
            if (onSelectNode) onSelectNode(path)
            if (node.action.kind === "navigate_to") onNavigate?.(node.action.stepId)
            else if (node.action.kind === "purchase") onPurchase?.()
            else onRestore?.()
          }}
        >
          {text(node.labelLid)}
        </button>
      )

    case "purchase_button":
      return (
        <button
          type="button"
          style={{
            width: "100%",
            border: "none",
            borderRadius: 26,
            padding: "14px 20px",
            background: "#6C4FC7",
            color: "#fff",
            fontSize: 15,
            fontWeight: 600,
            cursor: "pointer",
            ...editorRing,
          }}
          onClick={(e) => {
            e.stopPropagation()
            if (onSelectNode) onSelectNode(path)
            onPurchase?.()
          }}
        >
          {text(node.labelLid)}
        </button>
      )

    case "restore_purchases":
      return (
        <button
          type="button"
          style={{
            width: "100%",
            background: "none",
            border: "none",
            color: onSurfaceVariant,
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            cursor: "pointer",
            padding: "8px 0",
            ...editorRing,
          }}
          onClick={(e) => {
            e.stopPropagation()
            if (onSelectNode) onSelectNode(path)
            onRestore?.()
          }}
        >
          {text(node.labelLid)}
        </button>
      )

    case "footer":
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            marginTop: node.sticky ? "auto" : undefined,
            ...editorRing,
          }}
          {...click}
        >
          {node.components.map((child, i) => (
            <RenderNode key={i} {...props} node={child} path={`${path}.${i}`} parentAxis="vertical" grow={false} />
          ))}
        </div>
      )

    case "spacer":
      return <div style={grow ? { flex: 1 } : { height: px(node.size) }} />

    case "unknown":
      // Preserved, not dropped — and visible ONLY in the editor, because on a customer's screen an
      // unrenderable node should take up nothing rather than advertise a broken paywall.
      return onSelectNode ? (
        <div
          style={{
            border: "1px dashed #C9C3D6",
            borderRadius: 6,
            padding: "6px 10px",
            fontSize: 11,
            color: "#8A8296",
            ...editorRing,
          }}
          {...click}
        >
          unknown node: {node.type}
        </div>
      ) : null
  }
}
