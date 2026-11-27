import fs from "fs"
import path from "path"
import { SPA_SEGMENTS, isSpaPath, safeAfterLogin } from "@/lib/spa-paths"

describe("spa paths", () => {
  // A new app/(dashboard) folder the list misses would be served by Next and never reach the Vite app.
  it("lists exactly the app/(dashboard) folders", () => {
    const dir = path.join(__dirname, "../../app/(dashboard)")
    const folders = fs.readdirSync(dir).filter((f) => fs.statSync(path.join(dir, f)).isDirectory())
    expect([...SPA_SEGMENTS].sort()).toEqual(folders.sort())
  })

  it("matches dashboard paths only", () => {
    expect(isSpaPath("/products/abc/edit")).toBe(true)
    expect(isSpaPath("/coupons")).toBe(true)
    expect(isSpaPath("/")).toBe(false)
    expect(isSpaPath("/pricing")).toBe(false)
    expect(isSpaPath("/api/coupons")).toBe(false)
    expect(isSpaPath("/auth/login")).toBe(false)
  })

  // After sign-in the callback redirects to this value; anything off-site would be an open redirect.
  it("returns only same-site dashboard paths after login", () => {
    expect(safeAfterLogin("/products/abc?tab=pricing")).toBe("/products/abc?tab=pricing")
    expect(safeAfterLogin("/coupons#x")).toBe("/coupons#x")
    for (const bad of ["//evil.com/coupons", "https://evil.com", "/\\evil.com", "/pricing", "coupons", "", null, undefined]) {
      expect(safeAfterLogin(bad as string)).toBeNull()
    }
  })
})
