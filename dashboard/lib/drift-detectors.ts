import type { SupabaseClient } from "@supabase/supabase-js"
import { getConnectedStripeClient } from "./stripe-client"

/**
 * Drift detectors — reconcile, not flag-drain.
 *
 * Each detector READS the real state and diffs it against what PayCraft believes, so the badge
 * reflects what actually diverged rather than what someone remembered to flag. A drain over
 * `sync_status='pending'` was rejected for a measurable reason: on cappy it would have reported
 * all-green while the paywall row did not exist and Razorpay had zero payment links — every product
 * read `synced`, and the app could not be sold in INR at all.
 *
 * The five classes are not a taxonomy invented for completeness. Each is a defect measured on
 * production during the 2026-09-15 session:
 *
 *   1 product-missing-at-provider  — `cappy_plus_guardian` shared a `tenant_packages` row with
 *                                    monthly, so no component-tree node could address it
 *   2 paywall-not-published        — cappy had no `tenant_paywall` row; the SDK served bundled copy
 *                                    and a wellness app advertised "HD downloads"
 *   3 credential-mode-mismatch     — Razorpay's LIVE slot held an `rzp_test_` key, no webhook secret
 *   4 active-provider-zero-links   — that same provider was `is_active=true` with zero payment
 *                                    links, so `/config` filtered it out entirely
 *   5 missing-currency-for-country — no INR `tenant_pricing` rows, so IN buyers were quoted USD
 *
 * Every finding carries an `action_hint`. A finding without one is a complaint rather than a fix,
 * and the operator is left to work out what to do with it.
 */

export type DriftKind =
  | "product-missing-at-provider"
  | "paywall-not-published"
  | "credential-mode-mismatch"
  | "active-provider-zero-links"
  | "missing-currency-for-country"

export interface DriftFinding {
  kind: DriftKind
  tenant_id: string
  /** `product:cappy_plus_guardian`, `provider:razorpay`, `paywall`, `pricing:IN` */
  subject: string
  /** Human-readable, and it QUOTES the offending value — a finding you cannot confirm is noise. */
  detail: string
  /** A concrete next action, not a description of the problem. */
  action_hint: string
  /**
   * The row id the action operates on, when one exists. `subject` is for humans; this is what a
   * drain passes to `runProductSync`. Without it a finding can be read but not acted on
   * automatically, which is how a "needs attention" list becomes a list nobody can clear.
   */
  subject_id?: string
}

/** Class 1 — a product PayCraft believes is synced that the provider cannot return. */
export async function detectProductMissingAtProvider(
  supa: SupabaseClient,
  tenantId: string,
): Promise<DriftFinding[]> {
  const out: DriftFinding[] = []
  const { data: rows } = await supa
    .from("tenant_products")
    .select("id, sku, stripe_product_id, package_id")
    .eq("tenant_id", tenantId)
    .eq("active", true)

  if (!rows?.length) return out

  // One client for the whole sweep — a client per product would multiply the credential reads.
  let stripe: Awaited<ReturnType<typeof getConnectedStripeClient>> | null = null
  try {
    stripe = await getConnectedStripeClient(tenantId, "live")
  } catch {
    // No live credential is Class 3's finding, not this one. Reporting it twice would make the
    // operator fix the same root cause from two different rows.
    return out
  }

  // Two products sharing a package are unaddressable by the component tree even when both exist at
  // the provider — which is exactly how `cappy_plus_guardian` became invisible while looking healthy.
  const byPackage = new Map<string, string[]>()
  for (const r of rows) {
    if (!r.package_id) continue
    byPackage.set(r.package_id, [...(byPackage.get(r.package_id) ?? []), r.sku])
  }
  for (const [pkg, skus] of byPackage) {
    if (skus.length > 1) {
      out.push({
        kind: "product-missing-at-provider",
        tenant_id: tenantId,
        subject: `product:${skus.join(",")}`,
        detail: `${skus.length} products share package_id=${pkg}; only one can be rendered by the paywall tree`,
        action_hint: `Give each product its own tenant_packages role, then re-publish the paywall`,
      })
    }
  }

  for (const r of rows) {
    if (!r.stripe_product_id) continue
    try {
      const remote = await stripe.products.retrieve(r.stripe_product_id)
      if (!remote || remote.active === false) {
        out.push({
          kind: "product-missing-at-provider",
          tenant_id: tenantId,
          subject: `product:${r.sku}`,
          detail: `stripe_product_id=${r.stripe_product_id} is inactive at Stripe`,
          action_hint: `POST /api/products/${r.id}/sync?provider=stripe`,
        })
      }
    } catch {
      out.push({
        kind: "product-missing-at-provider",
        tenant_id: tenantId,
        subject: `product:${r.sku}`,
        subject_id: r.id,
        detail: `stripe_product_id=${r.stripe_product_id} not readable at Stripe`,
        action_hint: `POST /api/products/${r.id}/sync?provider=stripe`,
      })
    }
  }
  return out
}

/**
 * Class 2 — a paywall that exists but was never published.
 *
 * `published_workflow`, NOT a `status` column: `tenant_paywall` has no status field, and the SDK
 * renders from `published_workflow` only. A row can be fully configured on the write side while
 * every device still shows the SDK's bundled default.
 */
export async function detectPaywallNotPublished(
  supa: SupabaseClient,
  tenantId: string,
): Promise<DriftFinding[]> {
  const { data } = await supa
    .from("tenant_paywall")
    .select("tenant_id, published_workflow, workflow")
    .eq("tenant_id", tenantId)
    .maybeSingle()

  if (!data) {
    return [{
      kind: "paywall-not-published",
      tenant_id: tenantId,
      subject: "paywall",
      detail: "no tenant_paywall row — the SDK is serving its bundled default copy to every device",
      action_hint: "Run /idea-paycraft-onboard-app (A3) to apply and publish the default template",
    }]
  }
  if (data.published_workflow === null) {
    return [{
      kind: "paywall-not-published",
      tenant_id: tenantId,
      subject: "paywall",
      detail: data.workflow
        ? "a draft workflow exists but was never published; the SDK reads published_workflow only"
        : "no workflow at all; the SDK is serving its bundled default copy",
      action_hint: "Publish the paywall (tenant_paywall_publish), then re-check /config",
    }]
  }
  return []
}

/** Class 3 — a credential filed in the wrong mode, or missing the webhook secret that makes it usable. */
export async function detectCredentialModeMismatch(
  supa: SupabaseClient,
  tenantId: string,
): Promise<DriftFinding[]> {
  const out: DriftFinding[] = []
  const { data: rows } = await supa
    .from("tenant_providers")
    .select("provider, is_active, live_key_id, test_key_id, live_webhook_secret_enc")
    .eq("tenant_id", tenantId)

  for (const r of rows ?? []) {
    // A test-shaped key id sitting in the LIVE slot. Structurally "connected"; functionally dead.
    if (r.live_key_id && /_test_/.test(r.live_key_id)) {
      out.push({
        kind: "credential-mode-mismatch",
        tenant_id: tenantId,
        subject: `provider:${r.provider}`,
        detail: `live_key_id="${r.live_key_id}" is a TEST key in the live slot`,
        action_hint: `Replace the live credential for ${r.provider} in Providers → ${r.provider}`,
      })
    }
    if (r.is_active && r.live_key_id && !r.live_webhook_secret_enc) {
      out.push({
        kind: "credential-mode-mismatch",
        tenant_id: tenantId,
        subject: `provider:${r.provider}`,
        detail: `${r.provider} is active with a live key but no webhook secret — entitlements will never arrive`,
        action_hint: `Add the live webhook secret for ${r.provider}`,
      })
    }
  }
  return out
}

/**
 * Class 4 — an active provider that cannot actually take money.
 *
 * What "cannot take money" MEANS depends on the provider kind, and conflating them produces false
 * findings that train an operator to ignore the report:
 *
 *   PSP (stripe / razorpay / cashfree) — checkout is a payment LINK. Zero links while `is_active`
 *     reads true is the cappy/Razorpay case: both fields green independently, and `/config` filters
 *     the provider out entirely so the buyer sees a paywall with nothing to pay through.
 *
 *   NATIVE STORE (google_play / app_store) — there are no payment links, and there never will be.
 *     Checkout is the store SDK, and readiness is whether each product carries its store product id.
 *     Flagging a correctly-configured native store for "0 payment links" was this detector's own
 *     bug, found by running it against cappy: all three products had `play_product_id` and
 *     `app_store_product_id` set, and the report still cried wolf three times.
 */
const PSP_PROVIDERS = new Set(["stripe", "razorpay", "cashfree"])
const NATIVE_PROVIDERS = new Set(["google_play", "app_store"])

export async function detectActiveProviderZeroLinks(
  supa: SupabaseClient,
  tenantId: string,
): Promise<DriftFinding[]> {
  const out: DriftFinding[] = []
  const { data: rows } = await supa
    .from("tenant_providers")
    .select("provider, is_active, live_payment_links, test_payment_links")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)

  const linkCount = (m: unknown): number => {
    if (!m || typeof m !== "object") return 0
    return Object.values(m as Record<string, unknown>).reduce<number>((n, perCurrency) => {
      if (!perCurrency || typeof perCurrency !== "object") return n
      return n + Object.keys(perCurrency as Record<string, unknown>).length
    }, 0)
  }

  const nativeActive = (rows ?? []).filter((r) => NATIVE_PROVIDERS.has(r.provider))
  if (nativeActive.length) {
    const { data: products } = await supa
      .from("tenant_products")
      .select("sku, play_product_id, app_store_product_id")
      .eq("tenant_id", tenantId)
      .eq("active", true)

    for (const r of nativeActive) {
      const col = r.provider === "google_play" ? "play_product_id" : "app_store_product_id"
      const missing = (products ?? [])
        .filter((p) => !(p as Record<string, unknown>)[col])
        .map((p) => p.sku)
      if (missing.length) {
        out.push({
          kind: "active-provider-zero-links",
          tenant_id: tenantId,
          subject: `provider:${r.provider}`,
          detail: `${r.provider} is active but ${missing.length} product(s) have no ${col}: ${missing.join(", ")}`,
          action_hint: `Sync products to ${r.provider} so each carries its store product id`,
        })
      }
    }
  }

  for (const r of rows ?? []) {
    if (!PSP_PROVIDERS.has(r.provider)) continue
    const live = linkCount(r.live_payment_links)
    const test = linkCount(r.test_payment_links)
    if (live === 0 && test === 0) {
      out.push({
        kind: "active-provider-zero-links",
        tenant_id: tenantId,
        subject: `provider:${r.provider}`,
        detail: `${r.provider} is_active=true with 0 payment links — /config will filter it out entirely`,
        action_hint: `Sync products to ${r.provider} (POST /api/sync/all) to generate checkout links`,
      })
    }
  }
  return out
}

/**
 * Class 5 — a country is served but has no price row, so buyers there fall back to the base currency.
 *
 * Measured: `IND`/`IN` resolved ₹299.00 from `tenant_pricing` while a tenant without those rows
 * quoted USD to the same buyer.
 */
export async function detectMissingCurrencyForCountry(
  supa: SupabaseClient,
  tenantId: string,
): Promise<DriftFinding[]> {
  const out: DriftFinding[] = []
  const { data: providers } = await supa
    .from("tenant_providers")
    .select("provider, supported_locales")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)

  const served = new Set<string>()
  for (const p of providers ?? []) {
    for (const loc of (p.supported_locales as string[] | null) ?? []) served.add(loc)
  }
  if (served.size === 0) return out

  const { data: priced } = await supa
    .from("tenant_pricing")
    .select("locale")
    .eq("tenant_id", tenantId)

  const havePrice = new Set((priced ?? []).map((r) => r.locale))
  for (const country of served) {
    if (!havePrice.has(country)) {
      out.push({
        kind: "missing-currency-for-country",
        tenant_id: tenantId,
        subject: `pricing:${country}`,
        detail: `a provider serves ${country} but tenant_pricing has no row for it — buyers fall back to the base currency`,
        action_hint: `Add ${country} pricing on the product's Pricing tab`,
      })
    }
  }
  return out
}

/** All five, in a fixed order so the report is stable between refreshes. */
export const DRIFT_DETECTORS = [
  detectProductMissingAtProvider,
  detectPaywallNotPublished,
  detectCredentialModeMismatch,
  detectActiveProviderZeroLinks,
  detectMissingCurrencyForCountry,
] as const

export const DRIFT_KINDS: DriftKind[] = [
  "product-missing-at-provider",
  "paywall-not-published",
  "credential-mode-mismatch",
  "active-provider-zero-links",
  "missing-currency-for-country",
]
