import { activeAppHintCookie, wantsSpaShell } from "@/lib/spa-shell"

describe("spa shell", () => {
  it("serves the shell for dashboard GETs on the dashboard host only", () => {
    const u = (s: string) => new URL(s)
    expect(wantsSpaShell("GET", u("https://paycraft.mobilebytesensei.com/coupons"))).toBe(true)
    expect(wantsSpaShell("GET", u("https://paycraft.mobilebytesensei.com/products/abc/edit"))).toBe(true)
    expect(wantsSpaShell("POST", u("https://paycraft.mobilebytesensei.com/coupons"))).toBe(false)
    expect(wantsSpaShell("GET", u("https://paycraft.mobilebytesensei.com/pricing"))).toBe(false)
    expect(wantsSpaShell("GET", u("https://paycraft.mobilebytesensei.com/api/coupons"))).toBe(false)
    expect(wantsSpaShell("GET", u("https://api.paycraft.mobilebytesensei.com/coupons"))).toBe(false)
    expect(wantsSpaShell("GET", u("https://mcp.paycraft.mobilebytesensei.com/dashboard"))).toBe(false)
  })

  // The shell can't read the httpOnly active-app cookie; a wrong hint would show one app while /api uses another.
  it("keeps the readable active-app hint in step with the httpOnly choice", () => {
    expect(activeAppHintCookie("paycraft_active_app_id=A")).toMatch(/^pc_active_app=A;/)
    expect(activeAppHintCookie("paycraft_active_app_id=B; pc_active_app=A")).toMatch(/^pc_active_app=B;/)
    expect(activeAppHintCookie("paycraft_active_app_id=A; pc_active_app=A")).toBeNull()
    expect(activeAppHintCookie("pc_active_app=A")).toMatch(/^pc_active_app=; .*Max-Age=0/)
    expect(activeAppHintCookie(null)).toBeNull()
  })
})
