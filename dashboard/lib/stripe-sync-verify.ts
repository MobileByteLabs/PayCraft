import type Stripe from "stripe"
import { getConnectedStripeClient } from "./stripe-client"

export type SyncVerification = "verified" | "stale" | "unsynced" | "unknown"

/**
 * Cross-check each PayCraft product's saved stripe_product_id against the
 * CURRENT connected Stripe account. Returns a Map keyed by tenant_products.id
 * with one of four states:
 *
 *   verified  — DB has an ID and Stripe confirms it lives on this account
 *   stale     — DB has an ID but Stripe returns resource_missing
 *                (account was rotated, or product was deleted on Stripe side)
 *   unsynced  — DB has no ID at all
 *   unknown   — couldn't reach Stripe (no key configured, rate limit, etc)
 *
 * The Stripe API is hit in parallel (Promise.all) — for 4 products this
 * adds ~200ms to render time; for 100+ products you may want to switch to
 * a background job. We deliberately don't cache: the operator may change
 * keys at any time and the chip must reflect reality.
 */
export async function verifyStripeProductSync(
  tenantId: string,
  rows: Array<{ id: string; stripe_product_id: string | null }>,
): Promise<Map<string, SyncVerification>> {
  const out = new Map<string, SyncVerification>()
  for (const r of rows) {
    out.set(r.id, r.stripe_product_id ? "unknown" : "unsynced")
  }

  const rowsNeedingProbe = rows.filter((r) => !!r.stripe_product_id)
  if (rowsNeedingProbe.length === 0) return out

  // Single Stripe client per tenant — the wrapper falls back to Manual keys
  // when OAuth isn't connected, so this covers both onboarding paths.
  let stripe: Stripe
  try {
    stripe = await getConnectedStripeClient(tenantId)
  } catch {
    // No Stripe credentials at all — leave existing IDs as "unknown" so the
    // chip can render "marked synced, can't verify". The /providers/stripe
    // CTA still surfaces from elsewhere on the page.
    return out
  }

  await Promise.all(
    rowsNeedingProbe.map(async (r) => {
      try {
        await stripe.products.retrieve(r.stripe_product_id!)
        out.set(r.id, "verified")
      } catch (e: any) {
        const isMissing =
          e?.code === "resource_missing" ||
          String(e?.message ?? "").includes("No such product")
        out.set(r.id, isMissing ? "stale" : "unknown")
      }
    }),
  )
  return out
}
