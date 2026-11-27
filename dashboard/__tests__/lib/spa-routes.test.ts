import fs from "fs"
import path from "path"

// spa/routes.tsx lists one route per app/(dashboard) page; a page added without a route would 404 in the Vite app.
describe("spa routes", () => {
  it("has a route for every dashboard page", () => {
    const root = path.join(__dirname, "../../app/(dashboard)")
    const pages: string[] = []
    const walk = (dir: string) => {
      for (const f of fs.readdirSync(dir)) {
        const p = path.join(dir, f)
        if (fs.statSync(p).isDirectory()) walk(p)
        else if (f === "page.tsx") pages.push("/" + path.relative(root, dir).split(path.sep).join("/").replace("[id]", "$id"))
      }
    }
    walk(root)
    const src = fs.readFileSync(path.join(__dirname, "../../spa/routes.tsx"), "utf8")
    const routed = [...src.matchAll(/page\("([^"]+)"/g)].map((m) => m[1])
    expect(routed.sort()).toEqual(pages.sort())
  })
})
