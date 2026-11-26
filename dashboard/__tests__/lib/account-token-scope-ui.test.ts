import fs from "fs"
import path from "path"

/**
 * Every scope the account-tokens API accepts must be offerable on Settings ▸ Access tokens, and the page must
 * offer nothing the API refuses. `analytics:write` (migration 216) and `allowance:refund` were accepted by the API
 * but missing from the checklist — so no owner could grant them (2026-11-26).
 */
const read = (p: string) => fs.readFileSync(path.join(__dirname, "..", "..", p), "utf-8")

function apiScopes(): Set<string> {
  const src = read("app/api/account-tokens/route.ts")
  const block = src.slice(src.indexOf("const SCOPES = ["), src.indexOf("] as const", src.indexOf("const SCOPES = [")))
  return new Set([...block.matchAll(/"([a-z_]+:[a-z_]+)"/g)].map((m) => m[1]))
}

function uiScopes(): Set<string> {
  const src = read("components/settings/account-tokens-client.tsx")
  return new Set([...src.matchAll(/\{ id: "([a-z_]+:[a-z_]+)", detail:/g)].map((m) => m[1]))
}

describe("access-token scope checklist", () => {
  it("offers exactly the scopes the API accepts", () => {
    const api = apiScopes()
    const ui = uiScopes()
    expect(api.size).toBeGreaterThan(15)
    expect([...api].filter((s) => !ui.has(s)).sort()).toEqual([])
    expect([...ui].filter((s) => !api.has(s)).sort()).toEqual([])
  })
})
