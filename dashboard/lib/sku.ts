// The SKU naming convention, as the dashboard checks it before writing.
//
// The source of truth is the DATABASE — supabase/migrations/179_sku_naming_convention.sql
// (`paycraft_sku_is_canonical` + the tenant_products trigger), which every writer (dashboard, API, MCP,
// onboarding) goes through. This mirror only lets a form or an API answer say what is wrong before the
// round-trip; __tests__/lib/sku.test.ts fails if the two patterns ever differ.
//
// A SKU is lowercase kebab-case, 2..64 characters: pro-monthly · pro-annual · plus-lifetime · coins-100.
// Store product ids are not SKUs — they keep play_product_id / app_store_product_id and the stores' rules.
// SKUs created before migration 179 are grandfathered: they keep working and can be edited, only a NEW or
// RENAMED SKU must follow the convention.

/** Must stay byte-identical to the pattern in migration 179 (a test enforces it). */
export const SKU_PATTERN = "^[a-z0-9]+(-[a-z0-9]+)*$"
export const SKU_MIN = 2
export const SKU_MAX = 64

const RE = new RegExp(SKU_PATTERN)

export const SKU_RULE = "lowercase kebab-case, 2-64 characters (e.g. pro-monthly)"

export function isCanonicalSku(sku: string): boolean {
  return sku.length >= SKU_MIN && sku.length <= SKU_MAX && RE.test(sku)
}

const PERIOD_WORD: Record<string, string> = {
  day: "daily",
  week: "weekly",
  month: "monthly",
  quarter: "quarterly",
  semiannual: "semiannual",
  year: "annual",
}

/** The conventional SKU for a plan tier, e.g. ("pro", "year") → "pro-annual"; a lifetime plan (no interval) → "pro-lifetime". */
export function skuFor(tier: string, interval: string | null | undefined): string {
  const word = interval ? (PERIOD_WORD[interval] ?? interval) : "lifetime"
  return `${tier}-${word}`.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")
}
