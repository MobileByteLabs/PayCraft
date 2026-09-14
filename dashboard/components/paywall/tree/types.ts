/**
 * The component-tree model, mirroring `PaywallNode.kt` in the SDK.
 *
 * ## Why this is a mirror and not a shared package
 * The SDK is Kotlin Multiplatform and the dashboard is Next.js on the edge; there is no artifact
 * both can consume without adding a build step to each. So the model is duplicated — deliberately,
 * and with the duplication made testable: `tree-parity.test.ts` parses the SAME seed files the
 * Kotlin tests parse, so the two parsers cannot silently disagree about what a tree means.
 *
 * The one thing that must never drift is the TYPE VOCABULARY, because the server validates against
 * it (migration 100, `v_known_types`). A type this file forgets renders as `unknown` here while the
 * SDK renders it properly — a dashboard preview that lies about the app.
 */

export type Axis = "vertical" | "horizontal" | "z"

export interface Edges {
  top: number
  leading: number
  bottom: number
  trailing: number
}

export const ZERO_EDGES: Edges = { top: 0, leading: 0, bottom: 0, trailing: 0 }

/** `selected` / `intro_offer` — the same closed set the SDK's `Condition` enum carries. */
export type Condition = "selected" | "intro_offer"

export interface Override {
  conditions: Condition[]
  properties: Record<string, string>
}

interface NodeBase {
  overrides: Override[]
}

export interface StackNode extends NodeBase {
  kind: "stack"
  axis: Axis
  components: PaywallNode[]
  spacing: number
  padding: Edges
  margin: Edges
  backgroundHex: string | null
  horizontalAlignment: "leading" | "center" | "trailing"
  cornerRadius: number
  borderHex: string | null
  borderWidth: number
}

export interface TextNode extends NodeBase {
  kind: "text"
  textLid: string
  fontSize: number
  fontWeight: number
  colorHex: string | null
  alignment: "leading" | "center" | "trailing"
  padding: Edges
  margin: Edges
}

export interface IconNode extends NodeBase {
  kind: "icon"
  name: string
  size: number
  tintHex: string | null
}

export interface ImageNode extends NodeBase {
  kind: "image"
  url: string | null
  cornerRadius: number
  padding: Edges
  margin: Edges
}

export interface PackageNode extends NodeBase {
  kind: "package"
  roleIdentifier: string
  isSelectedByDefault: boolean
  stack: StackNode
}

/** What a {@link ButtonNode} does. Closed set — an unreadable action becomes an `unknown` node. */
export type ButtonAction =
  | { kind: "navigate_to"; stepId: string }
  | { kind: "purchase" }
  | { kind: "restore" }

/** The node that makes a multi-step paywall navigable (D15). */
export interface ButtonNode extends NodeBase {
  kind: "button"
  labelLid: string
  action: ButtonAction
  stack: StackNode | null
}

export interface PurchaseButtonNode extends NodeBase {
  kind: "purchase_button"
  labelLid: string
  stack: StackNode | null
}

export interface RestoreNode extends NodeBase {
  kind: "restore_purchases"
  labelLid: string
}

export interface FooterNode extends NodeBase {
  kind: "footer"
  components: PaywallNode[]
  sticky: boolean
}

export interface SpacerNode extends NodeBase {
  kind: "spacer"
  size: number
  grow: boolean
}

/** Preserved, never dropped — a dropped node takes its whole subtree with it. */
export interface UnknownNode extends NodeBase {
  kind: "unknown"
  type: string
}

export type PaywallNode =
  | StackNode
  | TextNode
  | IconNode
  | ImageNode
  | PackageNode
  | ButtonNode
  | PurchaseButtonNode
  | RestoreNode
  | FooterNode
  | SpacerNode
  | UnknownNode

export interface WorkflowStep {
  id: string
  name: string
  isLastStep: boolean
  root: PaywallNode | null
}

export interface PaywallWorkflow {
  schemaVersion: number
  initialStepId: string | null
  steps: WorkflowStep[]
  localizations: Record<string, Record<string, string>>
  colorScheme: "light" | "dark"
}

/** Price for one package role, resolved by the caller — never authored into the tree. */
export interface PackagePrice {
  display: string
  perPeriodNote?: string | null
  savingsPercent?: number | null
}

export interface RenderContext {
  locale: string
  hasIntroOffer: boolean
  selectedPackageRole: string | null
}
