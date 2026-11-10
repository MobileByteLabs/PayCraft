// The SKU naming convention: the database owns it (migration 179); the dashboard mirror must match it
// exactly, or a form would accept what the database then refuses (or the reverse).
import { readFileSync } from "fs"
import { join } from "path"
import { SKU_MAX, SKU_MIN, SKU_PATTERN, isCanonicalSku, skuFor } from "@/lib/sku"

const MIGRATION = join(__dirname, "../../../supabase/migrations/179_sku_naming_convention.sql")

describe("SKU naming convention", () => {
  it("mirrors the database rule byte-for-byte (pattern and length bounds)", () => {
    const sql = readFileSync(MIGRATION, "utf8")
    const fn = sql.slice(sql.indexOf("CREATE OR REPLACE FUNCTION paycraft_sku_is_canonical"), sql.indexOf("COMMENT ON FUNCTION"))
    expect(fn).toContain(`p_sku ~ '${SKU_PATTERN}'`)
    expect(fn).toContain(`length(p_sku) BETWEEN ${SKU_MIN} AND ${SKU_MAX}`)
  })

  it("accepts lowercase kebab-case only", () => {
    for (const ok of ["pro-monthly", "pro-annual", "plus-lifetime", "coins-100", "lifetime"]) expect(isCanonicalSku(ok)).toBe(true)
    for (const bad of ["pro_monthly", "com.x.app.sub.month", "Pro-Monthly", "pro--monthly", "-pro", "pro-", "p", "a".repeat(65)]) {
      expect(isCanonicalSku(bad)).toBe(false)
    }
  })

  it("names plan tiers by the convention", () => {
    expect(skuFor("pro", "month")).toBe("pro-monthly")
    expect(skuFor("pro", "quarter")).toBe("pro-quarterly")
    expect(skuFor("pro", "semiannual")).toBe("pro-semiannual")
    expect(skuFor("pro", "year")).toBe("pro-annual")
    expect(skuFor("Pro Plus", "week")).toBe("pro-plus-weekly")
    expect(skuFor("pro", null)).toBe("pro-lifetime")
    for (const i of ["day", "week", "month", "quarter", "semiannual", "year", null]) expect(isCanonicalSku(skuFor("pro", i))).toBe(true)
  })
})
