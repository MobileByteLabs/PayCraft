import { readFileSync } from "fs"
import { join } from "path"
import {
  Json,
  layerRows,
  locate,
  moveNode,
  patchNode,
  removeNode,
  insertNode,
  setLocalizedText,
  stepRoot,
  NODE_PALETTE,
} from "@/components/paywall/tree/edit"
import { parseWorkflow } from "@/components/paywall/tree/parse"

const SEED_DIR = join(
  __dirname,
  "../../../cmp-paycraft/src/commonMain/composeResources/files/paycraft/seed",
)
function seedJson(name: string): Json {
  return JSON.parse(readFileSync(join(SEED_DIR, `${name}.json`), "utf8")) as Json
}

describe("paths agree with the renderer's", () => {
  it("resolves the step root and nested package stacks", () => {
    const wf = seedJson("minimal")
    const root = stepRoot(wf)!
    expect(root.type).toBe("stack")

    // "0.1" is the first package; "0.1.stack" its card; "0.1.stack.0" the card's title row.
    expect(locate(root, "0")!.node).toBe(root)
    expect(locate(root, "0.1")!.node.type).toBe("package")
    expect(locate(root, "0.1.stack")!.node.type).toBe("stack")
    expect(locate(root, "0.1.stack.0")!.node.type).toBe("stack")
  })

  it("returns null for a stale path instead of throwing", () => {
    const root = stepRoot(seedJson("minimal"))!
    // A selection can outlive the node it points at; crashing there would lose the user's work.
    expect(locate(root, "0.99")).toBeNull()
    expect(locate(root, "0.1.stack.0.0.0.0")).toBeNull()
    expect(locate(root, "nonsense")).toBeNull()
  })
})

describe("edits preserve what this build does not understand", () => {
  it("keeps unknown sibling fields and unknown node types through a patch", () => {
    // A tree authored by a NEWER dashboard: fields and a node type this build never heard of.
    const root: Json = {
      type: "stack",
      dimension: "vertical",
      node_position: { x: 12, y: 40 },
      future_field: { deeply: { nested: true } },
      components: [
        { type: "text", text_lid: "t", experimental_shadow: "0 2px 8px" },
        { type: "hologram", intensity: 0.7, components: [{ type: "text", text_lid: "inner" }] },
      ],
    }

    const edited = patchNode(root, "0.0", { font_size: 22 })

    expect(edited.node_position).toEqual({ x: 12, y: 40 })
    expect(edited.future_field).toEqual({ deeply: { nested: true } })
    const kids = edited.components as Json[]
    expect(kids[0].experimental_shadow).toBe("0 2px 8px")
    expect(kids[0].font_size).toBe(22)
    // The unknown node and its subtree are untouched — the renderer substitutes it, the editor
    // does not delete it.
    expect(kids[1].type).toBe("hologram")
    expect(kids[1].intensity).toBe(0.7)
    expect((kids[1].components as Json[])[0].text_lid).toBe("inner")
  })

  it("does not mutate the input", () => {
    const root = stepRoot(seedJson("minimal"))!
    const before = JSON.stringify(root)
    patchNode(root, "0.0", { font_size: 99 })
    removeNode(root, "0.0")
    moveNode(root, "0.1", 1)
    expect(JSON.stringify(root)).toBe(before)
  })
})

describe("structural edits", () => {
  it("removes a node and leaves the tree parseable", () => {
    const wf = seedJson("minimal")
    const root = stepRoot(wf)!
    const before = (root.components as unknown[]).length
    const after = removeNode(root, "0.0")
    expect((after.components as unknown[]).length).toBe(before - 1)

    wf.steps = [{ id: "paywall", is_last_step: true, components_config: after }]
    expect(parseWorkflow(wf)).not.toBeNull()
  })

  it("refuses to remove the step root", () => {
    const root = stepRoot(seedJson("minimal"))!
    expect(removeNode(root, "0")).toBe(root)
  })

  it("moves a node within its parent and clamps at the ends", () => {
    const root = stepRoot(seedJson("minimal"))!
    const kids = () => (root.components as Json[]).map((k) => k.type)
    const original = kids()

    const moved = moveNode(root, "0.0", 1)
    const movedTypes = (moved.components as Json[]).map((k) => k.type)
    expect(movedTypes[0]).toBe(original[1])
    expect(movedTypes[1]).toBe(original[0])

    // Off either end is a no-op, not a wrap-around: wrapping moves a node somewhere the user
    // did not point at.
    expect(moveNode(root, "0.0", -1)).toBe(root)
    expect(moveNode(root, `0.${original.length - 1}`, 1)).toBe(root)
  })

  it("inserts every palette node so the result still parses", () => {
    const wf = seedJson("minimal")
    let root = stepRoot(wf)!
    for (const entry of NODE_PALETTE) {
      root = insertNode(root, "0", entry.make(), true)
    }
    wf.steps = [{ id: "paywall", is_last_step: true, components_config: root }]
    const parsed = parseWorkflow(wf)
    expect(parsed).not.toBeNull()
    // None of the palette entries may land as `unknown` — that would mean the editor offers a node
    // the renderer cannot draw.
    const types: string[] = []
    const walk = (n: { kind: string; components?: unknown[] }) => {
      types.push(n.kind)
      ;(n.components as { kind: string }[] | undefined)?.forEach((c) => walk(c as never))
    }
    walk(parsed!.steps[0].root as never)
    expect(types).not.toContain("unknown")
  })
})

describe("layer tree", () => {
  it("lists nodes depth-first with resolved copy as labels", () => {
    const wf = seedJson("minimal")
    const rows = layerRows(stepRoot(wf)!, (wf.localizations as Json).en_US as Record<string, string>)

    expect(rows[0]).toMatchObject({ path: "0", type: "stack", depth: 0 })
    // The title row reads as its COPY, not as its lid — a row saying "text: title" tells an author
    // nothing about which text on screen it is.
    expect(rows.some((r) => r.label === "Upgrade to Premium")).toBe(true)
    expect(rows.some((r) => r.type === "package" && r.label === "$rc_annual")).toBe(true)
    expect(rows.some((r) => r.label.startsWith("CTA — Continue"))).toBe(true)
    // A text layer whose copy is a variable names its ROLE; `{{ product.price }}` as a label is
    // accurate and tells an author nothing about what they are clicking.
    expect(rows.some((r) => r.label === "Price")).toBe(true)
    expect(rows.some((r) => r.label === "Savings badge")).toBe(true)
    expect(rows.every((r) => !r.label.includes("{{"))).toBe(true)

    // Depth increases into a package's stack.
    const pkg = rows.find((r) => r.type === "package")!
    const inner = rows.find((r) => r.path === `${pkg.path}.stack`)!
    expect(inner.depth).toBe(pkg.depth + 1)
  })
})

describe("copy editing", () => {
  it("writes a lid into a locale, creating the table when absent", () => {
    const wf = seedJson("minimal")
    const updated = setLocalizedText(wf, "fr_FR", "title", "Passez au Pro")
    expect(((updated.localizations as Json).fr_FR as Json).title).toBe("Passez au Pro")
    // The original locale is untouched, and the input is not mutated.
    expect(((updated.localizations as Json).en_US as Json).title).toBe("Upgrade to Premium")
    expect((wf.localizations as Json).fr_FR).toBeUndefined()
  })
})
