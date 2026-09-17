import React from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync, writeFileSync, existsSync } from "fs"
import { join } from "path"
import { TemplateGallery, type GalleryTemplate } from "@/components/paywall/template-gallery"

/**
 * Renders the real gallery to static HTML and writes it to /tmp for visual inspection.
 *
 * The authenticated page cannot be opened headlessly — sign-in is OAuth-only — so this is how the
 * renderer's OUTPUT gets looked at rather than assumed. It renders the shipped component with the
 * shipped seeds; the only thing it does not exercise is the page's data fetch and auth.
 */

const SEED_DIR = join(
  __dirname,
  "../../../cmp-paycraft/src/commonMain/composeResources/files/paycraft/seed",
)

const GALLERY: Array<[string, string, string, string, number]> = [
  ["branded-stack", "branded_stack", "Branded Stack", "featured", 10],
  ["premium", "premium", "Premium", "featured", 20],
  ["minimal", "minimal", "Minimal", "simple", 30],
  ["dark", "dark", "Dark", "simple", 40],
]

function templates(): GalleryTemplate[] {
  return GALLERY.map(([slug, file, name, category, sort_order]) => {
    const path = join(SEED_DIR, `${file}.json`)
    expect(existsSync(path)).toBe(true)
    return {
      slug,
      name,
      description: `${name} template`,
      category,
      sort_order,
      schema_version: 2,
      workflow: JSON.parse(readFileSync(path, "utf8")),
    }
  })
}

describe("template gallery renders", () => {
  it("draws every template's tree, with prices and CTAs", () => {
    const html = renderToStaticMarkup(
      React.createElement(TemplateGallery, {
        templates: templates(),
        hasExistingTree: true,
        currentRevision: 3,
      }),
    )

    writeFileSync(
      "/tmp/gallery-preview.html",
      `<!doctype html><meta charset="utf-8">
       <style>body{margin:0;padding:24px;background:#f4f4f5;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
       .grid{display:grid;gap:24px;grid-template-columns:repeat(3,minmax(0,1fr))}</style>
       ${html}`,
      "utf8",
    )

    // Every card drew its tree, not a placeholder.
    expect(html).not.toContain("could not be parsed")
    for (const [, , name] of GALLERY) expect(html).toContain(name)

    // The trees rendered their content: sample prices, savings, CTA, restore.
    expect(html).toContain("$41.99")
    expect(html).toContain("SAVE 50%")
    expect(html).toContain("Continue")
    expect(html).toContain("Restore")

    // "Update from this template" only exists when there IS something to merge into.
    expect(html).toContain("Update from this template")
  })

  it("hides the update action for a tenant with no tree yet", () => {
    const html = renderToStaticMarkup(
      React.createElement(TemplateGallery, {
        templates: templates(),
        hasExistingTree: false,
        currentRevision: null,
      }),
    )
    expect(html).toContain("Use this template")
    expect(html).not.toContain("Update from this template")
  })
})
