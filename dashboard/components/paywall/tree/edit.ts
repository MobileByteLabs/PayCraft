/**
 * Editing operations over the RAW workflow JSON.
 *
 * ## Why edits are applied to the JSON and not to the parsed model
 * `parse.ts` is deliberately lossy: it models what the renderer needs and ignores everything else —
 * `node_position` from the multi-screen designer, fields a NEWER dashboard added, anything this
 * build has not learned yet. That is correct for rendering and catastrophic for saving. If the
 * editor round-tripped through the model, opening a tree authored by a newer dashboard and pressing
 * Save would silently delete every field this build did not understand, and the loss would surface
 * later as a paywall that stopped doing something nobody could explain.
 *
 * So the document is the source of truth. Edits mutate a structural clone of the JSON; the parsed
 * model is derived from it for preview only, and thrown away. Unknown fields ride along untouched.
 *
 * ## Paths
 * A path is the same string the renderer hands to `onSelectNode`, so clicking the preview and
 * clicking the layer tree select the same node: `"0"` is the step root, `"0.2"` its third child,
 * `"0.2.stack.1"` the second child of a package's stack.
 */

export type Json = Record<string, unknown>

export function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isObj(v: unknown): v is Json {
  return !!v && typeof v === "object" && !Array.isArray(v)
}

/** The step root a path is rooted at. Multi-screen workflows edit one step at a time (D15). */
export function stepRoot(workflowJson: Json, stepId?: string): Json | null {
  const steps = Array.isArray(workflowJson.steps) ? (workflowJson.steps as unknown[]) : []
  const target =
    steps.find((s) => isObj(s) && s.id === (stepId ?? workflowJson.initial_step_id)) ?? steps[0]
  return isObj(target) && isObj(target.components_config) ? (target.components_config as Json) : null
}

export interface Located {
  node: Json
  /** The array the node lives in, and its index — null for the step root, which has no parent. */
  container: unknown[] | null
  index: number
  parent: Json | null
}

/**
 * Resolve a path to the node, its containing array and its parent.
 *
 * Returns null rather than throwing on a stale path: the layer tree and the preview can hold a
 * selection across an edit that removed the node, and a crash there would lose the user's work.
 */
export function locate(root: Json, path: string): Located | null {
  const parts = path.split(".")
  if (parts.length === 0 || parts[0] !== "0") return null

  let node: Json = root
  let container: unknown[] | null = null
  let index = -1
  let parent: Json | null = null

  for (const part of parts.slice(1)) {
    if (part === "stack") {
      if (!isObj(node.stack)) return null
      parent = node
      node = node.stack as Json
      container = null
      index = -1
      continue
    }
    const i = Number(part)
    if (!Number.isInteger(i)) return null
    const kids = Array.isArray(node.components) ? (node.components as unknown[]) : null
    if (!kids || !isObj(kids[i])) return null
    parent = node
    container = kids
    index = i
    node = kids[i] as Json
  }
  return { node, container, index, parent }
}

/** Apply a shallow property patch; `undefined` removes a key so "clear this" is expressible. */
export function patchNode(root: Json, path: string, patch: Json): Json {
  const next = clone(root)
  const found = locate(next, path)
  if (!found) return root
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) delete found.node[k]
    else found.node[k] = v
  }
  return next
}

export function removeNode(root: Json, path: string): Json {
  const next = clone(root)
  const found = locate(next, path)
  // The step root is not removable: a step with no components_config is a screen that renders
  // nothing, which the server's validator rejects anyway.
  if (!found || !found.container) return root
  found.container.splice(found.index, 1)
  return next
}

/** Move a node within its own parent. Cross-parent drag is intentionally not supported yet. */
export function moveNode(root: Json, path: string, delta: number): Json {
  const next = clone(root)
  const found = locate(next, path)
  if (!found || !found.container) return root
  const to = found.index + delta
  if (to < 0 || to >= found.container.length) return root
  const [item] = found.container.splice(found.index, 1)
  found.container.splice(to, 0, item)
  return next
}

/** Insert a new node after `path`, or as the first child when `path` is a container. */
export function insertNode(root: Json, path: string, node: Json, asChild = false): Json {
  const next = clone(root)
  const found = locate(next, path)
  if (!found) return root
  if (asChild || !found.container) {
    const kids = Array.isArray(found.node.components)
      ? (found.node.components as unknown[])
      : (found.node.components = [] as unknown[])
    ;(kids as unknown[]).push(node)
    return next
  }
  found.container.splice(found.index + 1, 0, node)
  return next
}

/** The path of each node, depth-first — the order the layer tree lists them. */
/** Steps in a workflow, for the editor's step switcher (D15). */
export interface StepRow {
  id: string
  name: string
  isLast: boolean
}

export function stepRows(workflowJson: Json): StepRow[] {
  const steps = Array.isArray(workflowJson.steps) ? (workflowJson.steps as unknown[]) : []
  return steps
    .map((s) => (isObj(s) ? s : null))
    .filter((s): s is Json => s !== null && typeof s.id === "string")
    .map((s) => ({
      id: s.id as string,
      name: typeof s.name === "string" ? (s.name as string) : (s.id as string),
      isLast: s.is_last_step === true,
    }))
}

/** Destinations a `navigate_to` button may point at — every step except the one it sits on. */
export function navigationTargets(workflowJson: Json, from: string): StepRow[] {
  return stepRows(workflowJson).filter((s) => s.id !== from)
}

export interface LayerRow {
  path: string
  type: string
  label: string
  depth: number
}

export function layerRows(root: Json, localizations: Record<string, string>): LayerRow[] {
  const rows: LayerRow[] = []
  const walk = (node: Json, path: string, depth: number) => {
    const type = typeof node.type === "string" ? node.type : "unknown"
    rows.push({ path, type, label: labelFor(node, type, localizations), depth })
    if (isObj(node.stack)) walk(node.stack as Json, `${path}.stack`, depth + 1)
    const kids = Array.isArray(node.components) ? (node.components as unknown[]) : []
    kids.forEach((k, i) => {
      if (isObj(k)) walk(k as Json, `${path}.${i}`, depth + 1)
    })
  }
  walk(root, "0", 0)
  return rows
}

const VARIABLE_LABELS: Record<string, string> = {
  "{{ product.price }}": "Price",
  "{{ product.price_per_period }}": "Price per period",
  "{{ product.offer_savings }}": "Savings %",
  "{{ product.offer_savings_label }}": "Savings badge",
}

/**
 * A human label for a node. Copy is resolved through the localization table, because a row reading
 * `text: hero_title` tells the author nothing about which text on screen it is.
 */
function labelFor(node: Json, type: string, localizations: Record<string, string>): string {
  const lid = typeof node.text_lid === "string" ? node.text_lid : null
  switch (type) {
    case "text": {
      if (!lid) return "text"
      const copy = localizations[lid] ?? lid
      // Copy that IS a variable reads as `{{ product.price }}` in a layer list — accurate and
      // useless. Name the role instead; the properties panel still shows the raw variable, so
      // nothing is hidden from whoever wants to edit it.
      const friendly = VARIABLE_LABELS[copy.trim()]
      return friendly ?? copy
    }
    case "package":
      return typeof node.package_id === "string" ? node.package_id : "package"
    case "purchase_button":
      return lid ? `CTA — ${localizations[lid] ?? lid}` : "purchase button"
    case "restore_purchases":
      return lid ? `Restore — ${localizations[lid] ?? lid}` : "restore"
    case "stack": {
      const dim = node.dimension === "horizontal" ? "row" : node.dimension === "zlayer" ? "layers" : "column"
      const n = Array.isArray(node.components) ? node.components.length : 0
      return `${dim} · ${n} item${n === 1 ? "" : "s"}`
    }
    case "spacer":
      return node.grow === true ? "flexible space" : `space ${node.size ?? 8}`
    case "icon":
      return typeof node.icon_name === "string" ? `icon — ${node.icon_name}` : "icon"
    default:
      return type
  }
}

/** Read/write a localized string for a node's lid, creating the entry if needed. */
export function setLocalizedText(
  workflowJson: Json,
  locale: string,
  lid: string,
  value: string,
): Json {
  const next = clone(workflowJson)
  const locs = isObj(next.localizations) ? (next.localizations as Json) : (next.localizations = {} as Json)
  const table = isObj((locs as Json)[locale])
    ? ((locs as Json)[locale] as Json)
    : ((locs as Json)[locale] = {} as Json)
  ;(table as Json)[lid] = value
  return next
}

/** Palette entries the "add node" menu offers — the subset the SDK can definitely render. */
export const NODE_PALETTE: Array<{ type: string; label: string; make: () => Json }> = [
  { type: "text", label: "Text", make: () => ({ type: "text", text_lid: "new_text", font_size: 14 }) },
  {
    type: "stack",
    label: "Column",
    make: () => ({ type: "stack", dimension: "vertical", spacing: 8, components: [] }),
  },
  {
    type: "stack-row",
    label: "Row",
    make: () => ({ type: "stack", dimension: "horizontal", spacing: 8, components: [] }),
  },
  { type: "spacer", label: "Space", make: () => ({ type: "spacer", size: 8 }) },
  {
    // Defaults to `purchase` — an action that is valid the instant it is created. A navigate
    // button needs a destination only the author knows, and creating it with an empty one yields a
    // node the parser (rightly) refuses, so a freshly added button would not be a node at all.
    // The properties panel switches the action and picks the step.
    type: "button",
    label: "Button",
    make: () => ({ type: "button", text_lid: "new_button", action: { type: "purchase" } }),
  },
  { type: "spacer-grow", label: "Flexible space", make: () => ({ type: "spacer", size: 0, grow: true }) },
  {
    type: "purchase_button",
    label: "Purchase button",
    make: () => ({ type: "purchase_button", text_lid: "cta_continue" }),
  },
  {
    type: "restore_purchases",
    label: "Restore purchases",
    make: () => ({ type: "restore_purchases", text_lid: "restore_label" }),
  },
]
