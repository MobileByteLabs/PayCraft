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
 * Two later classes follow the same rule — each is a measured defect, not a category added for
 * symmetry:
 *
 *   6 active-provider-no-credential — a provider switched on and never connected matched neither
 *                                     branch of class 3 and fell through to class 4, whose remedy
 *                                     is a sync that cannot work
 *   7 no-test-credential            — live key present, test key absent (measured on cappy,
 *                                     2026-09-22): sync can only create LIVE products, so a
 *                                     `pk_test_` build resolves no link and the only way to
 *                                     exercise a purchase is with real money
 *
 * Every finding carries an `action_hint`. A finding without one is a complaint rather than a fix,
 * and the operator is left to work out what to do with it.
 */

export type DriftKind =
  | "product-missing-at-provider"
  | "paywall-not-published"
  | "credential-mode-mismatch"
  | "active-provider-no-credential"
  | "active-provider-zero-links"
  | "missing-currency-for-country"
  | "no-test-credential"
  | "test-links-missing"

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
    .select(
      "provider, is_active, live_key_id, test_key_id, live_webhook_secret_enc, store_credential_enc",
    )
    .eq("tenant_id", tenantId)

  const connectivity = await resolvedConnectivity(supa, tenantId)

  for (const r of rows ?? []) {
    // ACTIVE WITH NO CREDENTIAL AT ALL.
    //
    // This branch is the one Class 1 already defers to ("No live credential is Class 3's finding,
    // not this one") and Class 5 now defers to as well — but until it existed, nothing implemented
    // the case. Both branches below require `live_key_id` to be PRESENT, so a provider switched on
    // and never connected fell through Class 3 entirely and surfaced under Class 5 as
    // "zero payment links", whose hint is "sync products to <provider>". That sync cannot succeed:
    // it returns `skipped — <provider> is not connected for this tenant` for every product, so the
    // finding returns unchanged on the next sweep. That is precisely the failure this file already
    // names for the razorpay-plans case — "a finding no action can clear trains the operator to
    // ignore the banner". Observed on tenant cappy, 2026-09-20: razorpay is_active=true with every
    // credential column empty, three products skipped on each drain.
    //
    // The remedy is CONNECT, not sync, so it gets its own kind and its own hint.
    if (r.is_active && connectivity && connectivity.get(r.provider) === false) {
      const what = NATIVE_PROVIDERS.has(r.provider) ? "store credential" : "API key"
      out.push({
        kind: "active-provider-no-credential",
        tenant_id: tenantId,
        subject: `provider:${r.provider}`,
        detail: `${r.provider} is_active=true but has no ${what} — it cannot authenticate, so every product sync to it is skipped`,
        action_hint: `Connect ${r.provider} in Providers → ${r.provider} (or deactivate it if unused)`,
      })
      continue
    }

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

/**
 * Which providers does this app actually RESOLVE a credential for?
 *
 * ONE definition, shared by Class 3 (which reports the absence) and Class 5 (which defers to it) —
 * and it is not a definition this file invents. `tenant_providers_resolved_list` (migration 110)
 * calls `tenant_provider_resolve` (115) per provider, whose rule is "connected means the resolver
 * would hand out a credential": a PINNED account, else the app's own key, else the account default.
 *
 * READING THE COLUMNS DIRECTLY IS WRONG, and this is the second time that mistake has been made
 * here. A credential belongs to the ACCOUNT ("an operator running six apps off one Play console
 * connects it once"), so an account-attached app has `provider_account_id` set and every local key
 * column NULL. Asking `live_key_id IS NULL` of such a row answers "no credential" about an app that
 * is billing live right now. Migration 115 was written for exactly that false negative — Reels
 * Downloader billing through Stripe while the index said `connected=false`, "two truths on one
 * screen". Measured on production tenant cappy 2026-09-20: razorpay, app_store and google_play all
 * resolve through accounts, and all three have empty key columns.
 *
 * Failure is NOT treated as "uncredentialed": if the RPC cannot be read we return null and every
 * caller degrades to reporting nothing, because inventing a finding from an unreadable source is
 * how an outage becomes a spurious "connect your provider" banner.
 */
async function resolvedConnectivity(
  supa: SupabaseClient,
  tenantId: string,
): Promise<Map<string, boolean> | null> {
  const { data, error } = await supa.rpc("tenant_providers_resolved_list", { p_tenant_id: tenantId })
  if (error || !Array.isArray(data)) return null
  return new Map(
    (data as { provider: string; connected: boolean }[]).map((r) => [r.provider, !!r.connected]),
  )
}

export async function detectActiveProviderZeroLinks(
  supa: SupabaseClient,
  tenantId: string,
): Promise<DriftFinding[]> {
  const out: DriftFinding[] = []
  const { data: rows } = await supa
    .from("tenant_providers")
    .select(
      "provider, is_active, live_payment_links, test_payment_links, live_key_id, test_key_id, store_credential_enc",
    )
    .eq("tenant_id", tenantId)
    .eq("is_active", true)

  const linkCount = (m: unknown): number => {
    if (!m || typeof m !== "object") return 0
    return Object.values(m as Record<string, unknown>).reduce<number>((n, perCurrency) => {
      if (!perCurrency || typeof perCurrency !== "object") return n
      return n + Object.keys(perCurrency as Record<string, unknown>).length
    }, 0)
  }

  // Defer every uncredentialed provider to Class 3, the same way Class 1 already does. Without
  // this, one root cause is reported twice under two kinds with two different remedies, and only
  // one of them can work.
  const connectivity = await resolvedConnectivity(supa, tenantId)
  const credentialed = (rows ?? []).filter((r) => connectivity?.get(r.provider) !== false)

  const nativeActive = credentialed.filter((r) => NATIVE_PROVIDERS.has(r.provider))
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

  // A PSP's synced artifact is NOT always a payment link. Razorpay turns a subscription into a
  // PLAN, and stores it in `razorpay_plan_id_by_currency` — no link is ever created. Counting links
  // alone therefore reported a fully-synced Razorpay as "0 payment links" forever: the sync ran, the
  // plans were written, the finding came back unchanged, and the suggested action ("sync products to
  // razorpay") was the very thing that had just succeeded. A finding no action can clear trains the
  // operator to ignore the banner, which costs more than the check is worth.
  const pspActive = credentialed.filter((r) => PSP_PROVIDERS.has(r.provider))
  if (pspActive.length) {
    const { data: products } = await supa
      .from("tenant_products")
      .select("sku, type, stripe_product_id, razorpay_plan_id_by_currency")
      .eq("tenant_id", tenantId)
      .eq("active", true)

    /** Artifacts that prove this provider can actually serve this product. */
    const hasArtifact = (provider: string, p: Record<string, unknown>): boolean => {
      if (provider === "razorpay") {
        const plans = p.razorpay_plan_id_by_currency as Record<string, unknown> | null
        if (plans && Object.keys(plans).length > 0) return true
      }
      if (provider === "stripe" && p.stripe_product_id) return true
      return false
    }

    for (const r of pspActive) {
      const links = linkCount(r.live_payment_links) + linkCount(r.test_payment_links)
      if (links > 0) continue
      const unserved = (products ?? []).filter((p) => !hasArtifact(r.provider, p as Record<string, unknown>))
      // Links absent AND no per-product artifact either: genuinely nothing to charge against.
      if (unserved.length === 0) continue
      out.push({
        kind: "active-provider-zero-links",
        tenant_id: tenantId,
        subject: `provider:${r.provider}`,
        detail: `${r.provider} is_active=true with no payment link and no synced artifact for ${unserved.length} product(s): ${unserved.map((p) => p.sku).join(", ")} — /config will filter it out for those`,
        action_hint: `Sync products to ${r.provider} (POST /api/sync/all) so each carries a link or plan id`,
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
/**
 * Class 7 — the provider can only ever transact LIVE, so there is no way to exercise a purchase
 * without real money.
 *
 * Distinct from class 3 (`credential-mode-mismatch`, a TEST key sitting in the LIVE slot) and from
 * class 4 (`active-provider-no-credential`, no credential at all). Here the live credential is
 * present and correct — what is missing is its test counterpart, and nothing today says so.
 *
 * Why it earns a class of its own: `runProductSync` syncs into every CONFIGURED mode
 * (`stripe-route-helper.ts` — "Sync into EVERY configured mode, not just the preferred one"), so a
 * tenant with no test key silently gets live products only. `/config` then routes a `pk_test_`
 * caller to `test_payment_links`, which is `{}` — the dead-checkout-button case that comment
 * describes. The developer's build looks wired and buys nothing, or the developer gives up and
 * ships a `pk_live_` debug build and tests against real charges. Both failures are invisible
 * without this finding.
 *
 * Deliberately NOT gated on `is_active`: an inactive provider a merchant is still setting up is
 * exactly when adding the test key is cheapest.
 */
export async function detectNoTestCredential(
  supa: SupabaseClient,
  tenantId: string,
): Promise<DriftFinding[]> {
  const out: DriftFinding[] = []
  // Credentials are ACCOUNT-level (migration 112): an app does not own a provider credential, it
  // shares one. The per-app `test_key_id` / `live_key_id` columns are a pre-112 denormalization and
  // NOTHING has written them since — the last writers are migrations 049 and 057.
  //
  // Reading them alone therefore reports "no test key" for every app onboarded through the account
  // tier, however plainly the key sits on the shared account. Observed on cappy: the Stripe account
  // carries `config.test_key_id`, and this detector still raised the finding — a false positive
  // that also inflated `confirm_count`, which the sync drain makes the operator echo back.
  //
  // COALESCE keeps any genuinely per-app pre-112 row working, so the fix is strictly additive.
  const { data: rows, error } = await supa
    .from("tenant_providers")
    .select(
      "provider, is_active, live_key_id, test_key_id, test_payment_links, provider_accounts(config)",
    )
    .eq("tenant_id", tenantId)

  // An unreadable table must not become a "connect your test keys" banner — same fail-quiet rule
  // the connectivity-backed detectors use. A finding invented from an outage trains the operator
  // to ignore the list.
  if (error || !Array.isArray(rows)) return out

  for (const r of rows as unknown as {
    provider: string
    is_active: boolean | null
    live_key_id: string | null
    test_key_id: string | null
    test_payment_links: unknown
    // PostgREST types a to-one embed as an ARRAY even though it returns a single object here, and
    // the two shapes are indistinguishable at the call site — so normalise rather than pick one.
    provider_accounts:
      | { config: Record<string, string> | null }
      | { config: Record<string, string> | null }[]
      | null
  }[]) {
    const embedded = Array.isArray(r.provider_accounts) ? r.provider_accounts[0] : r.provider_accounts
    const acct = embedded?.config ?? {}
    const liveKey = acct.live_key_id ?? r.live_key_id
    const testKey = acct.test_key_id ?? r.test_key_id

    if (!liveKey) continue              // class 4 owns "no credential at all"
    if (testKey) continue               // both modes present — nothing to say

    const activeNote = r.is_active ? "" : " (provider is inactive, but the gap applies once enabled)"
    out.push({
      kind: "no-test-credential",
      tenant_id: tenantId,
      subject: `provider:${r.provider}`,
      detail:
        `${r.provider} has a live key (${liveKey}) and NO test key on its shared connection, so ` +
        `product sync can only ` +
        `create LIVE products and \`test_payment_links\` stays empty. A \`pk_test_\` build resolves ` +
        `no link and cannot check out; testing this provider means transacting against REAL ` +
        `products with REAL money${activeNote}.`,
      action_hint:
        `Add a ${r.provider} TEST-mode key in Providers → ${r.provider}, then run product sync — ` +
        `runProductSync writes every configured mode, so test products are created automatically. ` +
        `Note: the Stripe OAuth/Connect path carries a single mode; a tenant needs the manual ` +
        `API-key path (or a second test-mode connection) to hold both.`,
      subject_id: r.provider,
    })
  }
  return out
}

/**
 * Class 8 — the provider CAN transact in test mode and has live links, but zero TEST links.
 *
 * WHY NO EXISTING DETECTOR SEES THIS
 * `detectActiveProviderZeroLinks` counts `linkCount(live) + linkCount(test)` and returns early on
 * any non-zero total. A provider with three live links and no test links therefore reads as fully
 * synced. `detectNoTestCredential` does not fire either, because the test CREDENTIAL is present —
 * that is its whole precondition. So the one state that actually blocks test mode falls between
 * the two, and did: Stripe on cappy held a test key and three live links, every detector was quiet,
 * and a `pk_test_` build still had no link to open.
 *
 * The remedy is a plain re-sync. `runProductSync` writes every configured mode, so syncing this
 * provider creates the missing test artifacts without touching the live ones.
 */
/** Plan-artifact counts for Razorpay, whose synced artifact is a plan id rather than a link. */
async function razorpayPlanCounts(
  supa: SupabaseClient,
  tenantId: string,
): Promise<{ livePlans: number; testPlans: number; unverified: number }> {
  const { data, error } = await supa
    .from("tenant_products")
    .select("razorpay_plan_id_by_currency, razorpay_plan_id_by_currency_test, live_plan_ids_verified")
    .eq("tenant_id", tenantId)
  if (error || !Array.isArray(data)) return { livePlans: 0, testPlans: 0, unverified: 0 }
  const filled = (v: unknown) => !!v && typeof v === "object" && Object.keys(v as object).length > 0
  let livePlans = 0, testPlans = 0, unverified = 0
  for (const r of data as Record<string, unknown>[]) {
    const hasLive = filled(r.razorpay_plan_id_by_currency)
    if (filled(r.razorpay_plan_id_by_currency_test)) testPlans++
    if (hasLive && r.live_plan_ids_verified === true) livePlans++
    if (hasLive && r.live_plan_ids_verified !== true) unverified++
  }
  return { livePlans, testPlans, unverified }
}

export async function detectTestLinksMissing(
  supa: SupabaseClient,
  tenantId: string,
): Promise<DriftFinding[]> {
  const out: DriftFinding[] = []
  const { data: rows, error } = await supa
    .from("tenant_providers")
    .select(
      "provider, is_active, live_payment_links, test_payment_links, test_key_id, provider_accounts(config)",
    )
    .eq("tenant_id", tenantId)
  if (error || !Array.isArray(rows)) return out

  const count = (m: unknown): number => {
    if (!m || typeof m !== "object") return 0
    return Object.values(m as Record<string, unknown>).reduce((n: number, perCurrency) => {
      if (!perCurrency || typeof perCurrency !== "object") return n
      return n + Object.keys(perCurrency as Record<string, unknown>).length
    }, 0)
  }

  for (const r of rows as unknown as {
    provider: string
    is_active: boolean | null
    live_payment_links: unknown
    test_payment_links: unknown
    test_key_id: string | null
    provider_accounts:
      | { config: Record<string, string> | null }
      | { config: Record<string, string> | null }[]
      | null
  }[]) {
    // Stores have no payment links at all — their test mode is a sandbox purchase, not a link.
    if (NATIVE_PROVIDERS.has(r.provider)) continue

    const embedded = Array.isArray(r.provider_accounts) ? r.provider_accounts[0] : r.provider_accounts
    const testKey = embedded?.config?.test_key_id ?? r.test_key_id
    if (!testKey) continue              // class 7 owns "no test credential"

    // PLAN-STYLE providers (Razorpay subscriptions) never produce payment links — their synced
    // artifact is a plan id on tenant_products, mode-scoped since 141. Judging them by link counts
    // makes them permanently invisible here: both maps read `{sku: {}}`, so `live === 0` defers to
    // class 6, class 6 sees a plan artifact and stays quiet, and NOTHING ever asks for the re-sync
    // that would populate the test column. Measured: after 141 shipped, confirm_count was 0 while
    // Razorpay had zero test plans and three unverified live ones.
    if (r.provider === "razorpay") {
      const { livePlans, testPlans, unverified } = await razorpayPlanCounts(supa, tenantId)
      if (testPlans === 0 && (livePlans > 0 || unverified > 0)) {
        out.push({
          kind: "test-links-missing",
          tenant_id: tenantId,
          subject: `provider:${r.provider}`,
          detail:
            `razorpay has a test credential but ZERO test subscription plans. Razorpay subscriptions ` +
            `are plans, not payment links, so a test build has no plan to subscribe against.`,
          action_hint:
            `Run product sync — it writes every configured mode, creating the test plans alongside ` +
            `the live ones.`,
          subject_id: r.provider,
        })
      } else if (unverified > 0) {
        // Not a test-mode problem: these ids predate the mode split and may have been written by a
        // TEST sync, which would have live customers subscribing against a test plan.
        out.push({
          kind: "test-links-missing",
          tenant_id: tenantId,
          subject: `provider:${r.provider}`,
          detail:
            `${unverified} razorpay plan id(s) predate the mode split (migration 141) and may have ` +
            `been written by a TEST sync — live checkout reads that column.`,
          action_hint: `Run product sync to rewrite them from the live account.`,
          subject_id: r.provider,
        })
      }
      continue
    }

    const live = count(r.live_payment_links)
    const test = count(r.test_payment_links)
    if (live === 0) continue            // class 6 owns "nothing synced at all"
    if (test > 0) continue              // both modes present

    out.push({
      kind: "test-links-missing",
      tenant_id: tenantId,
      subject: `provider:${r.provider}`,
      detail:
        `${r.provider} has a test credential and ${live} LIVE payment link(s) but ZERO test links. ` +
        `A test build resolves no link and cannot check out, so the only way to exercise this ` +
        `provider is to transact against real products with real money.`,
      action_hint:
        `Run product sync for ${r.provider} — runProductSync writes every configured mode, so the ` +
        `test links are created alongside the existing live ones.`,
      subject_id: r.provider,
    })
  }
  return out
}

export const DRIFT_DETECTORS = [
  detectProductMissingAtProvider,
  detectPaywallNotPublished,
  detectCredentialModeMismatch,
  detectActiveProviderZeroLinks,
  detectTestLinksMissing,
  detectMissingCurrencyForCountry,
  detectNoTestCredential,
] as const

export const DRIFT_KINDS: DriftKind[] = [
  "product-missing-at-provider",
  "paywall-not-published",
  "credential-mode-mismatch",
  "active-provider-no-credential",
  "no-test-credential",
  "test-links-missing",
  "active-provider-zero-links",
  "missing-currency-for-country",
]
