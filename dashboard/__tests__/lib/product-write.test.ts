/**
 * Unit tests for the product WRITE merge (`lib/product-write.ts`).
 *
 * The thing under test is the read-merge-write that makes a partial update safe.
 * `tenant_products_upsert` overwrites twenty columns from `EXCLUDED`, so the failure mode is not
 * "the patch didn't apply" — it is "everything the patch didn't mention got nulled", silently,
 * on a product that may be synced to three live storefronts.
 */

import { buildProductRow, toRpcRow } from "@/lib/product-write"

const TENANT = "ba973ad0-8788-4c0f-89c8-1ff9533fa79f"

/** A product shaped like a real synced row, store ids included. */
const existing = {
  id: "p-1",
  sku: "cappy_plus_annual",
  type: "subscription",
  display_name: "Cappy Annual",
  trial_enabled: true,
  trial_duration_days: 14,
  trial_per_platform: { ios: 7, web: 7, android: 7, desktop: 7 },
  attaches_to_product_id: null,
  interval: "year",
  base_price_cents: 1000,
  base_currency: "USD",
  display_order: 3,
  active: true,
  pricing_mode: "auto",
  global_price_cents: null,
  global_currency: null,
  discount_percent: null,
  discount_ends_at: null,
  play_product_id: "com.mobilebytesensei.cappy.sub.year",
  app_store_product_id: "cappy.sub.year",
}

function row(patch: Record<string, unknown>, from: Record<string, unknown> | null = existing) {
  const r = buildProductRow(TENANT, String(from?.sku ?? "new_sku"), from, patch)
  if ("error" in r) throw new Error(`unexpected validation error: ${JSON.stringify(r)}`)
  return r.row
}

describe("buildProductRow — merge safety", () => {
  it("preserves store ids across a one-field patch", () => {
    // The whole point. A caller sending {display_name} must not detach the live Play/App Store
    // listings, which the upsert would do with a partial row.
    const r = row({ display_name: "Cappy Annual Plan" })
    expect(r.play_product_id).toBe("com.mobilebytesensei.cappy.sub.year")
    expect(r.app_store_product_id).toBe("cappy.sub.year")
    expect(r.display_name).toBe("Cappy Annual Plan")
  })

  it("carries every unmentioned mergeable column through unchanged", () => {
    const r = row({ display_order: 1 })
    expect(r.interval).toBe("year")
    expect(r.base_price_cents).toBe(1000)
    expect(r.base_currency).toBe("USD")
    expect(r.trial_duration_days).toBe(14)
    expect(r.active).toBe(true)
    expect(r.type).toBe("subscription")
    expect(r.display_order).toBe(1)
  })

  it("keeps the existing row's id so the upsert updates rather than inserting", () => {
    expect(row({ active: false }).id).toBe("p-1")
  })

  it("refuses to write store ids", () => {
    const r = buildProductRow(TENANT, "cappy_plus_annual", existing, {
      play_product_id: "something.else",
    })
    expect(r).toHaveProperty("error", "field_not_writable:play_product_id")
  })

  it("refuses tenant_id and id from the body", () => {
    expect(buildProductRow(TENANT, "s", existing, { tenant_id: "other" })).toHaveProperty(
      "error",
      "field_not_writable:tenant_id",
    )
    expect(buildProductRow(TENANT, "s", existing, { id: "other" })).toHaveProperty(
      "error",
      "field_not_writable:id",
    )
  })
})

describe("buildProductRow — trial_per_platform, the F1 field", () => {
  it("clears the override when sent null", () => {
    // resolvePlatformTrialDays prefers this map whenever non-empty, so clearing it is what makes
    // the scalar (14) govern again. cappy_plus_annual served a 7-day Play trial for exactly this
    // reason, and no API could empty the map.
    const r = row({ trial_per_platform: null })
    expect(r.trial_per_platform).toBeNull()
    expect(r.trial_duration_days).toBe(14)
  })

  it("normalises an empty object to null", () => {
    // {} and null read alike (the resolver falls back on an empty map) but store differently;
    // normalising stops the stored value disagreeing with the intent.
    expect(row({ trial_per_platform: {} }).trial_per_platform).toBeNull()
  })

  it("accepts a valid per-platform map", () => {
    expect(row({ trial_per_platform: { android: 14, ios: 14 } }).trial_per_platform).toEqual({
      android: 14,
      ios: 14,
    })
  })

  it("rejects an unknown platform key", () => {
    expect(buildProductRow(TENANT, "s", existing, { trial_per_platform: { tizen: 7 } })).toHaveProperty(
      "error",
      "trial_per_platform.tizen_unknown_platform",
    )
  })

  it("rejects a non-integer trial length", () => {
    expect(
      buildProductRow(TENANT, "s", existing, { trial_per_platform: { android: 7.5 } }),
    ).toHaveProperty("error", "trial_per_platform.android_must_be_integer_0_to_365")
  })
})

describe("buildProductRow — validation", () => {
  it("rejects an interval outside the check constraint", () => {
    expect(buildProductRow(TENANT, "s", existing, { interval: "fortnight" })).toHaveProperty(
      "error",
      "interval_invalid",
    )
  })

  it("accepts week, which migration 151 added", () => {
    expect(row({ interval: "week" }).interval).toBe("week")
  })

  it("rejects an unknown field rather than ignoring it", () => {
    // Silently dropping an unrecognised field is how a caller believes it set something it didn't.
    expect(buildProductRow(TENANT, "s", existing, { trial_days: 14 })).toHaveProperty(
      "error",
      "unknown_field:trial_days",
    )
  })

  it("rejects a negative price", () => {
    expect(buildProductRow(TENANT, "s", existing, { base_price_cents: -1 })).toHaveProperty(
      "error",
      "base_price_cents_must_be_non_negative_integer",
    )
  })

  it("upper-cases a currency", () => {
    expect(row({ base_currency: "inr" }).base_currency).toBe("INR")
  })
})

describe("buildProductRow — create", () => {
  it("applies defaults and requires a display_name", () => {
    const r = row({ display_name: "Cappy Weekly", interval: "week" }, null)
    expect(r.type).toBe("subscription")
    expect(r.active).toBe(true)
    expect(r.trial_enabled).toBe(true)
    expect(r.base_currency).toBe("USD")
    expect(r.id).toBeUndefined() // the RPC mints one
  })

  it("requires an interval for a subscription", () => {
    expect(buildProductRow(TENANT, "s", null, { display_name: "X" })).toHaveProperty(
      "error",
      "interval_required_for_subscription",
    )
  })

  it("does not require an interval for a one-time product", () => {
    const r = row({ display_name: "Lifetime", type: "one_time" }, null)
    expect(r.type).toBe("one_time")
  })
})

describe("toRpcRow", () => {
  it("serialises an object field as JSON text for the ::jsonb cast", () => {
    const out = toRpcRow({ trial_per_platform: { android: 14 } })
    expect(out.trial_per_platform).toBe('{"android":14}')
  })

  it("maps null to null so NULLIF clears the column", () => {
    expect(toRpcRow({ trial_per_platform: null }).trial_per_platform).toBeNull()
  })

  it("stringifies scalars", () => {
    const out = toRpcRow({ base_price_cents: 1000, active: false })
    expect(out.base_price_cents).toBe("1000")
    expect(out.active).toBe("false")
  })
})
