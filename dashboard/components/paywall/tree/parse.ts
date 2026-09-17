import {
  Axis,
  ButtonAction,
  Condition,
  Edges,
  Override,
  PaywallNode,
  PaywallWorkflow,
  StackNode,
  WorkflowStep,
  ZERO_EDGES,
} from "./types"

/**
 * Lenient JSON → tree, mirroring `PaywallTreeParser.kt`.
 *
 * Lenient in one specific way: an unrecognised node becomes `unknown` rather than throwing, because
 * the dashboard must stay usable against a tree written by a NEWER dashboard than the one running.
 * Every other malformation (no steps, unresolvable initial step) returns null, since there is
 * nothing to draw and pretending otherwise produces a blank canvas with no explanation.
 */

const KNOWN_CONDITIONS: Condition[] = ["selected", "intro_offer"]

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function str(o: Record<string, unknown>, k: string): string | null {
  const v = o[k]
  return typeof v === "string" ? v : null
}
function int(o: Record<string, unknown>, k: string): number | null {
  const v = o[k]
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null
}
function bool(o: Record<string, unknown>, k: string): boolean {
  return o[k] === true
}
function edges(o: Record<string, unknown>, k: string): Edges {
  const e = obj(o[k])
  if (!e) return ZERO_EDGES
  return {
    top: int(e, "top") ?? 0,
    leading: int(e, "leading") ?? 0,
    bottom: int(e, "bottom") ?? 0,
    trailing: int(e, "trailing") ?? 0,
  }
}

/**
 * Colour containers are `{light: {type: "hex", value: "#RRGGBBAA"}}` — the dashboard's own shape,
 * which is why the SDK had to convert and this does not. `light` is read rather than the active
 * scheme because a tree carries ONE authored palette; dark-mode trees say so via `color_scheme`.
 */
function colorHex(o: Record<string, unknown>, k: string): string | null {
  const container = obj(o[k])
  if (!container) return typeof o[k] === "string" ? (o[k] as string) : null
  const light = obj(container["light"]) ?? obj(container["value"]) ?? null
  if (!light) return null
  const inner = obj(light["light"]) ?? light
  return str(inner, "value")
}

function parseOverrides(v: unknown): Override[] {
  return arr(v)
    .map((el) => {
      const o = obj(el)
      if (!o) return null
      const conditions = arr(o["conditions"])
        .map((c) => {
          const co = obj(c)
          const t = co ? str(co, "type") : typeof c === "string" ? (c as string) : null
          return t && (KNOWN_CONDITIONS as string[]).includes(t) ? (t as Condition) : null
        })
        .filter((c): c is Condition => c !== null)
      // All-unrecognised conditions means the override would apply unconditionally — the opposite
      // of what it asks for — so it is dropped, exactly as the SDK drops it.
      if (conditions.length === 0) return null
      const props: Record<string, string> = {}
      const po = obj(o["properties"])
      if (po) {
        for (const [k, val] of Object.entries(po)) {
          if (typeof val === "string") props[k] = val
          else if (typeof val === "number" || typeof val === "boolean") props[k] = String(val)
        }
      }
      return { conditions, properties: props }
    })
    .filter((o): o is Override => o !== null)
}

function parseButtonAction(o: Record<string, unknown>): ButtonAction | null {
  const shorthand = str(o, "navigate_to")
  if (shorthand) return { kind: "navigate_to", stepId: shorthand }
  const a = obj(o["action"])
  if (!a) return null
  switch (str(a, "type")) {
    case "navigate_to": {
      const dest = str(a, "destination") ?? str(a, "step_id")
      return dest ? { kind: "navigate_to", stepId: dest } : null
    }
    case "purchase":
      return { kind: "purchase" }
    case "restore":
      return { kind: "restore" }
    default:
      return null
  }
}

function parseStack(o: Record<string, unknown>, overrides: Override[]): StackNode {
  const dim = str(o, "dimension") ?? str(o, "axis")
  const axis: Axis = dim === "horizontal" ? "horizontal" : dim === "zlayer" ? "z" : "vertical"
  const align = str(o, "horizontal_alignment")
  const shape = obj(o["shape"])
  const border = obj(o["border"])
  return {
    kind: "stack",
    axis,
    components: arr(o["components"]).map(parseNode),
    spacing: int(o, "spacing") ?? 0,
    padding: edges(o, "padding"),
    margin: edges(o, "margin"),
    backgroundHex: colorHex(o, "background") ?? colorHex(o, "background_color"),
    horizontalAlignment: align === "center" ? "center" : align === "trailing" ? "trailing" : "leading",
    cornerRadius: shape ? int(shape, "radius") ?? 0 : 0,
    borderHex: border ? colorHex(border, "color") : null,
    borderWidth: border ? int(border, "width") ?? 0 : 0,
    overrides,
  }
}

function parseNode(el: unknown): PaywallNode {
  const o = obj(el)
  if (!o) return { kind: "unknown", type: "<missing>", overrides: [] }
  const overrides = parseOverrides(o["overrides"])
  const type = str(o, "type")

  switch (type) {
    case "stack":
      return parseStack(o, overrides)
    case "text":
      return {
        kind: "text",
        textLid: str(o, "text_lid") ?? "",
        fontSize: int(o, "font_size") ?? 14,
        fontWeight: int(o, "font_weight_int") ?? 400,
        colorHex: colorHex(o, "color"),
        alignment:
          str(o, "horizontal_alignment") === "center"
            ? "center"
            : str(o, "horizontal_alignment") === "trailing"
              ? "trailing"
              : "leading",
        padding: edges(o, "padding"),
        margin: edges(o, "margin"),
        overrides,
      }
    case "icon":
      return {
        kind: "icon",
        name: str(o, "icon_name") ?? "",
        size: int(o, "size") ?? 24,
        tintHex: colorHex(o, "color"),
        overrides,
      }
    case "image": {
      const mask = obj(o["mask_shape"])
      const corners = mask ? obj(mask["corners"]) : null
      return {
        kind: "image",
        url: str(o, "url"),
        cornerRadius: corners ? int(corners, "top_leading") ?? 0 : 0,
        padding: edges(o, "padding"),
        margin: edges(o, "margin"),
        overrides,
      }
    }
    case "package": {
      const inner = obj(o["stack"])
      return {
        kind: "package",
        roleIdentifier: str(o, "package_id") ?? "",
        isSelectedByDefault: bool(o, "is_selected_by_default"),
        // The inner stack's OWN overrides — dropping them is what hid selected-state styling in
        // the SDK until a test caught it (D18). Same shape here, same reason.
        stack: inner
          ? parseStack(inner, parseOverrides(inner["overrides"]))
          : parseStack({}, []),
        overrides,
      }
    }
    case "button": {
      // An unreadable action degrades the whole node rather than drawing a control that does
      // nothing — the SDK makes the same choice, and the preview must not look more capable.
      const action = parseButtonAction(o)
      if (!action) return { kind: "unknown", type: "button", overrides }
      const inner = obj(o["stack"])
      return {
        kind: "button",
        labelLid: str(o, "text_lid") ?? "",
        action,
        stack: inner ? parseStack(inner, parseOverrides(inner["overrides"])) : null,
        overrides,
      }
    }
    case "purchase_button": {
      const inner = obj(o["stack"])
      return {
        kind: "purchase_button",
        labelLid: str(o, "text_lid") ?? "",
        stack: inner ? parseStack(inner, parseOverrides(inner["overrides"])) : null,
        overrides,
      }
    }
    case "restore_purchases":
      return { kind: "restore_purchases", labelLid: str(o, "text_lid") ?? "", overrides }
    case "footer":
      return {
        kind: "footer",
        components: arr(o["components"]).map(parseNode),
        sticky: bool(o, "sticky_footer"),
        overrides,
      }
    case "spacer":
      return { kind: "spacer", size: int(o, "size") ?? 8, grow: bool(o, "grow"), overrides }
    default:
      return { kind: "unknown", type: type ?? "<missing>", overrides }
  }
}

export function parseWorkflow(input: string | object | null | undefined): PaywallWorkflow | null {
  if (input === null || input === undefined) return null
  let root: Record<string, unknown> | null
  try {
    root = obj(typeof input === "string" ? JSON.parse(input) : input)
  } catch {
    return null
  }
  if (!root) return null

  const steps: WorkflowStep[] = arr(root["steps"])
    .map((el) => {
      const s = obj(el)
      if (!s) return null
      const id = str(s, "id")
      if (!id) return null
      const cc = obj(s["components_config"])
      return {
        id,
        name: str(s, "name") ?? id,
        isLastStep: bool(s, "is_last_step"),
        root: cc ? parseNode(cc) : null,
      }
    })
    .filter((s): s is WorkflowStep => s !== null)

  if (steps.length === 0) return null

  const localizations: Record<string, Record<string, string>> = {}
  const locs = obj(root["localizations"])
  if (locs) {
    for (const [locale, table] of Object.entries(locs)) {
      const t = obj(table)
      if (!t) continue
      const entries: Record<string, string> = {}
      for (const [lid, v] of Object.entries(t)) if (typeof v === "string") entries[lid] = v
      localizations[locale] = entries
    }
  }

  return {
    schemaVersion: int(root, "schema_version") ?? 1,
    initialStepId: str(root, "initial_step_id") ?? steps[0].id,
    steps,
    localizations,
    colorScheme: str(root, "color_scheme")?.toLowerCase() === "dark" ? "dark" : "light",
  }
}

/** 3-way fallback: exact locale → first locale → the lid itself, so copy never renders blank. */
export function resolveLid(wf: PaywallWorkflow, lid: string, locale: string): string {
  const exact = wf.localizations[locale]?.[lid]
  if (exact !== undefined) return exact
  const firstLocale = Object.keys(wf.localizations)[0]
  const fallback = firstLocale ? wf.localizations[firstLocale]?.[lid] : undefined
  return fallback ?? lid
}

/** Every package role the tree references, in tree order — used to fetch prices. */
export function packageRoles(wf: PaywallWorkflow): string[] {
  const roles: string[] = []
  const walk = (n: PaywallNode | null) => {
    if (!n) return
    switch (n.kind) {
      case "package":
        roles.push(n.roleIdentifier)
        walk(n.stack)
        break
      case "stack":
      case "footer":
        n.components.forEach(walk)
        break
      case "button":
      case "purchase_button":
        walk(n.stack)
        break
      default:
        break
    }
  }
  wf.steps.forEach((s) => walk(s.root))
  return Array.from(new Set(roles))
}

/** The role the AUTHOR marked default, mirroring `defaultSelectedRole()` in the SDK. */
export function defaultSelectedRole(wf: PaywallWorkflow): string | null {
  let found: string | null = null
  const walk = (n: PaywallNode | null) => {
    if (!n || found) return
    switch (n.kind) {
      case "package":
        if (n.isSelectedByDefault) found = n.roleIdentifier
        else walk(n.stack)
        break
      case "stack":
      case "footer":
        n.components.forEach(walk)
        break
      case "button":
      case "purchase_button":
        walk(n.stack)
        break
      default:
        break
    }
  }
  wf.steps.forEach((s) => walk(s.root))
  return found
}
