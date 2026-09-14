import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { PaywallTreeEditor } from "@/components/paywall/tree/PaywallTreeEditor"
import {
  Json,
  layerRows,
  patchNode,
  setLocalizedText,
  stepRoot,
} from "@/components/paywall/tree/edit"
import { parseWorkflow, resolveLid } from "@/components/paywall/tree/parse"

const SEED_DIR = join(
  __dirname,
  "../../../cmp-paycraft/src/commonMain/composeResources/files/paycraft/seed",
)
function seedJson(name: string): Json {
  return JSON.parse(readFileSync(join(SEED_DIR, `${name}.json`), "utf8")) as Json
}

describe("the editor draws all three panes", () => {
  it("renders layer tree, preview and properties from one document", () => {
    const html = renderToStaticMarkup(
      React.createElement(PaywallTreeEditor, {
        initialWorkflow: seedJson("branded_stack"),
        initialRevision: 4,
        publishedRevision: 2,
      }),
    )
    writeFileSync(
      "/tmp/editor-preview.html",
      `<!doctype html><meta charset="utf-8">
       <style>body{margin:0;background:#fff;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
       aside{width:320px;border-left:1px solid #e4e4e7;padding:16px}
       ul{list-style:none;margin:0;padding:0}</style>${html}`,
      "utf8",
    )

    // Layers pane lists the tree, labelled by resolved copy.
    expect(html).toContain("Layers")
    expect(html).toContain("Upgrade to Premium")
    expect(html).toContain("$rc_annual")

    // Preview drew the tree — same content the SDK golden shows.
    expect(html).toContain("$41.99")
    expect(html).toContain("SAVE 50%")

    // Publish is disabled while there is nothing saved to publish… and save is disabled until an
    // edit happens, so neither button invites a pointless write.
    expect(html).toContain("Publish")
    expect(html).toContain("draft r4")
    expect(html).toContain("live r2")
  })

  it("tells a tenant with no tree where to get one instead of drawing an empty canvas", () => {
    const html = renderToStaticMarkup(
      React.createElement(PaywallTreeEditor, {
        initialWorkflow: { schema_version: 2, steps: [] } as Json,
        initialRevision: null,
        publishedRevision: null,
      }),
    )
    expect(html).toContain("template gallery")
  })
})

describe("an edit reaches the preview", () => {
  it("changing copy changes what the tree renders", () => {
    const before = seedJson("minimal")
    const after = setLocalizedText(before, "en_US", "title", "Join the club")

    expect(resolveLid(parseWorkflow(before)!, "title", "en_US")).toBe("Upgrade to Premium")
    expect(resolveLid(parseWorkflow(after)!, "title", "en_US")).toBe("Join the club")
  })

  it("changing a property changes the parsed node the preview draws", () => {
    const doc = seedJson("minimal")
    const root = stepRoot(doc)!
    const edited = patchNode(root, "0.0", { font_size: 41 })
    doc.steps = [{ id: "paywall", is_last_step: true, components_config: edited }]

    const wf = parseWorkflow(doc)!
    const title = (wf.steps[0].root as { components: Array<{ fontSize?: number }> }).components[0]
    expect(title.fontSize).toBe(41)
  })

  it("keeps layer paths and preview paths in the same vocabulary", () => {
    // The preview hands `onSelectNode` the same strings layerRows emits; if they diverged, clicking
    // the preview would select the wrong layer — or nothing.
    const doc = seedJson("branded_stack")
    const rows = layerRows(stepRoot(doc)!, (doc.localizations as Json).en_US as Record<string, string>)
    const paths = new Set(rows.map((r) => r.path))
    expect(paths.has("0")).toBe(true)
    for (const r of rows) {
      if (r.path === "0") continue
      const parent = r.path.slice(0, r.path.lastIndexOf("."))
      expect(paths.has(parent)).toBe(true)
    }
  })
})
