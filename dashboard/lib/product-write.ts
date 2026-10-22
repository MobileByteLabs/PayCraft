/**
 * Validation + safe merge for the product WRITE path (`POST /v1/products`, `PATCH /v1/products/{id}`).
 *
 * ## Why this exists at all
 *
 * `tenant_products_upsert(p_row jsonb)` is an `INSERT … ON CONFLICT (tenant_id, sku) DO UPDATE`
 * whose UPDATE arm assigns **twenty** columns straight from `EXCLUDED`. A caller that sends a
 * partial row therefore does not "patch" anything — it NULLs every column it failed to mention,
 * `play_product_id` and `app_store_product_id` included. Orphaning those two detaches a live store
 * listing from the row that syncs it, and the next drain silently re-creates a duplicate.
 *
 * So a partial update is only safe as read-merge-write, and that merge has to live in exactly one
 * place. Before this module there was no product write endpoint at all, which is why every caller
 * — `/idea-paycraft` included — reached past the API into `psql` and called the RPC directly. That
 * made the DATABASE the source of truth and the API a read model over it. Each such caller
 * re-implements this merge, or (far more likely) does not, and nulls the store ids.
 *
 * ## Store ids are deliberately NOT writable
 *
 * `play_product_id` / `app_store_product_id` are owned by the sync, which sets them through
 * `tenant_products_set_store_ids` once a provider has actually accepted the product. Letting a
 * caller assert them would let PayCraft claim a store artifact that does not exist. They are
 * PRESERVED across every merge here and refused as input.
 *
 * ## `sku` is immutable on PATCH
 *
 * `sku` is the natural conflict key. Changing it through the upsert would not rename the product —
 * it would INSERT a second one and leave the original behind, still synced, still sellable.
 */

/** Billing intervals accepted by `tenant_products_interval_check` (migration 151 added `week`). */
export const VALID_INTERVALS = ["week", "month", "quarter", "semiannual", "year"] as const

/** `product_type` enum values. */
export const VALID_PRODUCT_TYPES = ["subscription", "one_time", "consumable"] as const

/**
 * What a sync lane may be handed.
 *
 * The live enum is `subscription | one_time | consumable`; `trial` and `lifetime` are LEGACY names
 * that predate it and still reach these functions from older rows and callers. Keeping them in the
 * type is deliberate — the lanes all branch on `=== "subscription"` and treat everything else as a
 * one-time charge, which is the correct behaviour for every member of this union, so narrowing it
 * would reject rows the system still has to sell rather than fix anything.
 */
export type SyncProductType = (typeof VALID_PRODUCT_TYPES)[number] | "trial" | "lifetime"

/** `pricing_mode` enum values. */
export const VALID_PRICING_MODES = ["auto", "global", "manual"] as const

/** Platform keys `resolvePlatformTrialDays` understands. */
export const VALID_PLATFORMS = ["android", "ios", "web", "desktop"] as const

/**
 * Every column the upsert's UPDATE arm overwrites, minus the two store ids (preserved, never
 * accepted) and `sku` (the conflict key). This is the exact set a merge must carry forward.
 */
export const MERGEABLE_COLUMNS = [
  "type",
  "display_name",
  "trial_enabled",
  "trial_duration_days",
  "trial_per_platform",
  "attaches_to_product_id",
  "interval",
  "base_price_cents",
  "base_currency",
  "display_order",
  "active",
  "pricing_mode",
  "global_price_cents",
  "global_currency",
  "discount_percent",
  "discount_ends_at",
  "grant_quantity",
  "grant_sku",
  "daily_earn_cap",
  "ad_reward_quantity",
  "daily_ad_reward_cap",
] as const

/** Columns the caller may never set directly. */
export const REFUSED_INPUT = ["play_product_id", "app_store_product_id", "tenant_id", "id"] as const

export interface ValidationError {
  error: string
  detail?: string
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * Validate one caller-supplied field. Returns the DB-shaped value, or an error.
 *
 * `undefined` means "not supplied" (leave alone on PATCH, use the default on POST). `null` is a
 * real instruction to CLEAR a nullable column — which is how `trial_per_platform` gets removed, the
 * one operation that fixes a product serving a per-platform trial length its catalogue disowns.
 */
function validateField(key: string, raw: unknown): { value: unknown } | ValidationError {
  switch (key) {
    case "display_name": {
      const v = String(raw ?? "").trim()
      if (!v) return { error: "display_name_must_not_be_empty" }
      if (v.length > 120) return { error: "display_name_too_long_max_120" }
      return { value: v }
    }
    case "type": {
      const v = String(raw ?? "").trim()
      if (!(VALID_PRODUCT_TYPES as readonly string[]).includes(v)) {
        return { error: "type_invalid", detail: `expected one of: ${VALID_PRODUCT_TYPES.join(", ")}` }
      }
      return { value: v }
    }
    case "interval": {
      if (raw === null) return { value: null }
      const v = String(raw ?? "").trim()
      if (!(VALID_INTERVALS as readonly string[]).includes(v)) {
        return { error: "interval_invalid", detail: `expected one of: ${VALID_INTERVALS.join(", ")}` }
      }
      return { value: v }
    }
    case "pricing_mode": {
      const v = String(raw ?? "").trim()
      if (!(VALID_PRICING_MODES as readonly string[]).includes(v)) {
        return { error: "pricing_mode_invalid", detail: `expected one of: ${VALID_PRICING_MODES.join(", ")}` }
      }
      return { value: v }
    }
    case "trial_enabled":
    case "active": {
      if (typeof raw !== "boolean") return { error: `${key}_must_be_boolean` }
      return { value: raw }
    }
    case "trial_duration_days": {
      if (raw === null) return { value: null }
      if (!Number.isInteger(raw) || (raw as number) < 0 || (raw as number) > 365) {
        return { error: "trial_duration_days_must_be_integer_0_to_365" }
      }
      return { value: raw }
    }
    case "trial_per_platform": {
      // null CLEARS the override so the scalar `trial_duration_days` governs every platform again.
      // This is the whole reason a product can advertise one trial length and serve another:
      // `resolvePlatformTrialDays` prefers this map whenever it is non-empty, and nothing in the
      // API could previously empty it.
      if (raw === null) return { value: null }
      if (!isPlainObject(raw)) {
        return { error: "trial_per_platform_must_be_object_or_null", detail: "null clears the override" }
      }
      const out: Record<string, number> = {}
      for (const [k, v] of Object.entries(raw)) {
        if (!(VALID_PLATFORMS as readonly string[]).includes(k)) {
          return { error: `trial_per_platform.${k}_unknown_platform`, detail: `expected: ${VALID_PLATFORMS.join(", ")}` }
        }
        if (!Number.isInteger(v) || (v as number) < 0 || (v as number) > 365) {
          return { error: `trial_per_platform.${k}_must_be_integer_0_to_365` }
        }
        out[k] = v as number
      }
      // An EMPTY object is not a clear — `resolvePlatformTrialDays` only falls back to the scalar
      // when the map has no keys, so `{}` and `null` behave alike at read time but store
      // differently. Normalised to null so the stored value cannot disagree with the intent.
      return { value: Object.keys(out).length === 0 ? null : out }
    }
    case "base_price_cents":
    case "global_price_cents": {
      if (raw === null) return { value: null }
      if (!Number.isInteger(raw) || (raw as number) < 0) return { error: `${key}_must_be_non_negative_integer` }
      return { value: raw }
    }
    case "base_currency":
    case "global_currency": {
      if (raw === null) return { value: null }
      const v = String(raw ?? "").trim().toUpperCase()
      if (!/^[A-Z]{3}$/.test(v)) return { error: `${key}_must_be_iso_4217` }
      return { value: v }
    }
    case "grant_quantity": {
      // Units one purchase of a consumable grants. Non-negative; 0 is legitimate for every other
      // product type, which is why this is not simply `>= 1` here — the cross-field rule below is
      // what refuses a consumable that grants nothing.
      if (raw === null) return { value: null }
      if (!Number.isInteger(raw) || (raw as number) < 0) {
        return { error: "grant_quantity_must_be_non_negative_integer" }
      }
      return { value: raw }
    }
    case "grant_sku": {
      // The currency this product credits. null = the product's own sku (unchanged behaviour).
      // Not validated against tenant_products: a currency id deliberately has no product row of its
      // own — it is a ledger partition key, not a sellable thing (migration 164).
      if (raw === null) return { value: null }
      if (typeof raw !== "string" || !raw.trim()) return { error: "grant_sku_must_be_a_non_empty_string" }
      return { value: raw.trim() }
    }
    case "daily_earn_cap":
    case "ad_reward_quantity":
    case "daily_ad_reward_cap": {
      // All three are OPT-INS, and null is the meaningful default: null daily_earn_cap disables
      // activity earning for the sku, null ad_reward_quantity disables ad rewards, null
      // daily_ad_reward_cap leaves ad rewards uncapped. 0 would be an ambiguous way to say "off"
      // for the first two and "no rewards ever" for the third, so it is refused — say null.
      if (raw === null) return { value: null }
      if (!Number.isInteger(raw) || (raw as number) < 1) {
        return { error: `${key}_must_be_a_positive_integer_or_null` }
      }
      return { value: raw }
    }
    case "display_order": {
      if (!Number.isInteger(raw)) return { error: "display_order_must_be_integer" }
      return { value: raw }
    }
    case "discount_percent": {
      if (raw === null) return { value: null }
      if (!Number.isInteger(raw) || (raw as number) < 0 || (raw as number) > 100) {
        return { error: "discount_percent_must_be_integer_0_to_100" }
      }
      return { value: raw }
    }
    case "discount_ends_at":
    case "attaches_to_product_id": {
      if (raw === null) return { value: null }
      return { value: String(raw) }
    }
    default:
      return { error: `unknown_field:${key}` }
  }
}

export interface BuildResult {
  row: Record<string, unknown>
}

/**
 * Build the COMPLETE row the upsert needs, from `existing` (null on create) plus `patch`.
 *
 * Every mergeable column is written explicitly — absent ones take the existing value, not a
 * default — because the RPC overwrites all of them regardless of what the caller mentioned.
 */
export function buildProductRow(
  tenantId: string,
  sku: string,
  existing: Record<string, unknown> | null,
  patch: Record<string, unknown>,
): BuildResult | ValidationError {
  for (const k of REFUSED_INPUT) {
    if (k in patch) {
      return {
        error: `field_not_writable:${k}`,
        detail:
          k === "play_product_id" || k === "app_store_product_id"
            ? "Store ids are set by the provider sync once the store accepts the product; asserting one here would claim a store artifact that may not exist."
            : "Identity is derived from the authenticated key and the route.",
      }
    }
  }

  // An unrecognised key is REFUSED, never dropped. Silently ignoring it returns 200 for a write
  // that did nothing — so `trial_days: 14` (a believable near-miss for `trial_duration_days`)
  // would report success while the product kept its old trial. Caught by this module's own tests.
  for (const k of Object.keys(patch)) {
    if (!(MERGEABLE_COLUMNS as readonly string[]).includes(k)) {
      return {
        error: `unknown_field:${k}`,
        detail: `writable fields: ${MERGEABLE_COLUMNS.join(", ")}`,
      }
    }
  }

  const row: Record<string, unknown> = { tenant_id: tenantId, sku }
  if (existing?.id) row.id = existing.id

  for (const col of MERGEABLE_COLUMNS) {
    if (col in patch) {
      const r = validateField(col, patch[col])
      if ("error" in r) return r
      row[col] = r.value
    } else if (existing) {
      row[col] = existing[col] ?? null
    }
  }

  // Store ids are carried through verbatim so the UPDATE arm cannot null them.
  if (existing) {
    row.play_product_id = existing.play_product_id ?? null
    row.app_store_product_id = existing.app_store_product_id ?? null
  }

  // Create-time defaults, applied only where the caller said nothing and there is no prior row.
  if (!existing) {
    if (!("type" in row)) row.type = "subscription"
    if (!("trial_enabled" in row)) row.trial_enabled = true
    if (!("active" in row)) row.active = true
    if (!("base_currency" in row)) row.base_currency = "USD"
    if (!("base_price_cents" in row)) row.base_price_cents = 0
    if (!("display_order" in row)) row.display_order = 0
    if (!("pricing_mode" in row)) row.pricing_mode = "auto"
    if (!row.display_name) return { error: "display_name_required" }
    if (!row.interval && row.type === "subscription") return { error: "interval_required_for_subscription" }
    // A consumable exists to GRANT something. Shipping one with grant_quantity 0 is the silent
    // failure this rule prevents: the purchase succeeds, Play consumes it so it is non-refundable
    // by the usual route, the webhook grants zero, and the buyer's balance never moves. Nothing
    // errors anywhere — the money is simply gone. Refusing at the API is the only place this is
    // still cheap to catch, which is why it mirrors interval_required_for_subscription above.
    if (row.type === "consumable" && !(Number(row.grant_quantity) > 0)) {
      return { error: "grant_quantity_required_for_consumable" }
    }
  }

  return { row }
}

/**
 * The jsonb the RPC expects: every value stringified except objects, which it casts with `::jsonb`.
 *
 * `NULLIF(p_row->>'x','')` is how the function reads nullables, so a JSON `null` (which `->>`
 * renders as SQL NULL) and an empty string both mean "clear". Objects must survive as JSON text.
 */
export function toRpcRow(row: Record<string, unknown>): Record<string, string | null> {
  const out: Record<string, string | null> = {}
  for (const [k, v] of Object.entries(row)) {
    if (v === null || v === undefined) out[k] = null
    else if (typeof v === "object") out[k] = JSON.stringify(v)
    else out[k] = String(v)
  }
  return out
}
