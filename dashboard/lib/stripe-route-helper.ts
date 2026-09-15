import { syncProductToStripe, toStripeInterval, type PriceInput } from "@/lib/stripe-product-sync"
import { syncProductToRazorpay } from "@/lib/razorpay-product-sync"
import { syncProductToCashfree } from "@/lib/cashfree-product-sync"
import { syncProductToGooglePlay } from "@/lib/googleplay-product-sync"
import { syncProductToAppStore } from "@/lib/appstore-product-sync"
import { createClient } from "@/lib/supabase-server"

interface SyncOptions {
  tenantId: string
  productId: string
  body: Record<string, any>
  existingStripeProductId?: string
  existingPrices?: Record<string, string>
  existingRazorpayPlanIds?: Record<string, string>
  existingPlayProductId?: string
  existingAppStoreProductId?: string
  /**
   * Sync only ONE provider this invocation. Cloudflare's free Workers/Pages tier
   * caps a single request at 50 subrequests; the full 5-provider fan-out exceeds
   * that, so callers on the free tier sync provider-by-provider (5 requests) and
   * each stays well under the cap. Result is merged into the existing sync_state.
   */
  onlyProvider?: "stripe" | "razorpay" | "cashfree" | "google_play" | "app_store"
  /**
   * When set, runProductSync emits a `sync_events` row per (product × provider)
   * start + result so the dashboard can show a live, human-readable progress
   * dialog. [productName] labels the events; all events share this [runId].
   */
  runId?: string
  productName?: string
}

const PROVIDER_LABEL: Record<string, string> = {
  stripe: "Stripe",
  razorpay: "Razorpay",
  cashfree: "Cashfree",
  google_play: "Google Play",
  app_store: "App Store",
}

/** Human, per-provider result line for the live sync dialog. */
function providerSyncMessage(label: string, product: string, entry: ProviderSyncEntry): string {
  switch (entry.status) {
    case "synced":
      return `${label}: ${product} synced`
    case "draft":
      return `${label}: ${product} base synced — offer pending (${entry.reason ?? entry.warning ?? "draft"})`
    case "skipped":
      return `${label}: skipped — ${entry.reason ?? "not applicable"}`
    case "failed":
      return `${label}: failed — ${entry.error ?? entry.reason ?? "error"}`
    default:
      return `${label}: ${entry.status}`
  }
}

/**
 * Resolve the free-trial length (in days) for ONE platform from a product body.
 *
 * Per-platform model (migration 087): `body.trial_per_platform` is a JSONB map
 * `{"android":30,"ios":14,"web":7,"desktop":14}` — a key PRESENT with an int means a
 * trial of that many days on that platform; a key ABSENT/null means NO trial there.
 * Returning 0 signals "no trial on this platform" — the W2 teardown then removes any
 * existing offer for that provider automatically.
 *
 * Legacy fallback: when `trial_per_platform` is absent/empty, use the single
 * `trial_enabled` + `trial_duration_days` pair fanned to every platform.
 *
 *   platformKey ∈ 'android' (Google Play) | 'ios' (App Store) | 'web' | 'desktop'
 */
export function resolvePlatformTrialDays(body: Record<string, any>, platformKey: string): number {
  const perPlatform = body.trial_per_platform
  if (perPlatform && typeof perPlatform === "object" && Object.keys(perPlatform).length > 0) {
    return Number(perPlatform[platformKey] ?? 0)
  }
  return body.trial_enabled && body.trial_duration_days ? Number(body.trial_duration_days) : 0
}

function buildPriceInputs(body: Record<string, any>): PriceInput[] {
  if (Array.isArray(body.pricing_rows) && body.pricing_rows.length > 0) {
    return body.pricing_rows.map((r: { currency: string; amount_cents: number }) => ({
      currency: r.currency,
      amountCents: r.amount_cents,
    }))
  }
  if (body.base_price_cents && body.base_currency) {
    return [{ currency: body.base_currency, amountCents: body.base_price_cents }]
  }
  return []
}

/**
 * Best-effort Stripe sync. Returns a STRUCTURED status so the durable sync-state
 * layer can show precise per-provider results + reasons (not connected → skipped;
 * real error → failed + reason; success → synced). Never throws.
 */
export async function stripeSyncProduct(
  supabase: ReturnType<typeof createClient>,
  opts: SyncOptions,
): Promise<{ ok?: boolean; skipped?: boolean; error?: string; reason?: string }> {
  const { tenantId, productId, body, existingStripeProductId, existingPrices } = opts
  try {
    // Unified status check — recognizes BOTH the OAuth Connect path and the
    // Manual API keys path. The old code only checked tenant_stripe_connect
    // (OAuth) and silently skipped manual-keys tenants, which is why products
    // created post-Manual-connection never landed in Stripe.
    const { data: connect, error: connectErr } = await supabase
      .rpc("tenant_stripe_provider_status", { p_tenant_id: tenantId })
      .single<{ source: string | null; account_id: string | null; livemode: boolean }>()
    if (connectErr || !connect?.source) return { skipped: true, reason: "Stripe is not connected" }

    const prices = buildPriceInputs(body)
    if (!prices.length) return { skipped: true, reason: "no pricing configured for this product" }

    // Web PSPs (Stripe / Razorpay / Cashfree) all check out through the SAME
    // web-checkout product, which carries ONE trial_period_days — so web + desktop
    // cannot have different trial lengths here. Use the 'web' value, falling back to
    // 'desktop' when only desktop is configured. (Native stores get their own value:
    // Google Play → 'android', App Store → 'ios'.)
    const trialDays =
      resolvePlatformTrialDays(body, "web") || resolvePlatformTrialDays(body, "desktop")

    // Sync into EVERY configured mode, not just the preferred one.
    //
    // This used to write links under `connect.livemode ? "live" : "test"` — one map, chosen for the
    // tenant. With a live key present that is always "live", so `test_payment_links` stayed `{}`
    // forever. `/config` then filters out any provider whose per-sku map is empty (correctly — a
    // provider with no link is a dead checkout button), so every `pk_test_` build saw
    // `Providers = 0` on a tenant with four connected providers. Observed on cappy.
    //
    // A Connect (OAuth) tenant still has exactly one account and one mode; only manual-key tenants
    // can hold both slots, and for those both are now kept in step.
    const { data: keyStatus } = await supabase
      .rpc("tenant_providers_status", { p_tenant_id: tenantId, p_provider: "stripe" })
      .single<{ test_key_id: string | null; live_key_id: string | null }>()

    const modes: ("live" | "test")[] = connect.source === "oauth"
      ? [connect.livemode ? "live" : "test"]
      : ([keyStatus?.live_key_id ? "live" : null, keyStatus?.test_key_id ? "test" : null]
          .filter(Boolean) as ("live" | "test")[])
    if (modes.length === 0) modes.push(connect.livemode ? "live" : "test")

    let lastResult: Awaited<ReturnType<typeof syncProductToStripe>> | null = null
    for (const mode of modes) {
      // One mode failing must not abandon the other — a missing test account is not a reason to
      // leave live unsynced, and vice versa.
      try {
        const result = await syncProductToStripe(
          tenantId,
          productId,
          body.display_name,
          body.type,
          toStripeInterval(body.interval),
          prices,
          { stripeProductId: existingStripeProductId, existingPrices },
          trialDays,
          connect.source === "oauth" ? undefined : mode,
        )
        lastResult = result
        // Nest under the product's SKU so multi-product tenants don't overwrite
        // each other's currency entries. Migration 070 introduced this RPC.
        await supabase.rpc("tenant_providers_merge_payment_links", {
          p_tenant_id: tenantId,
          p_provider: "stripe",
          p_mode: mode,
          p_sku: body.sku,
          p_payment_links: result.paymentLinksByCurrency,
        })
      } catch (e: any) {
        console.error(`[products] stripe ${mode} sync failed:`, e?.message ?? e)
      }
    }
    if (!lastResult) return { error: "stripe sync failed for every configured mode" }

    // Product/price ids are account-scoped; record the last successful sync's ids, preferring live
    // because that is the account the shipped app bills through.
    await supabase.rpc("tenant_products_set_stripe_ids", {
      p_id: productId,
      p_stripe_product_id: lastResult.stripeProductId,
      p_stripe_price_id_by_currency: lastResult.pricesByCurrency,
    })
    return { ok: true }
  } catch (e: any) {
    console.error("[products] stripe sync failed:", e.message)
    return { error: e?.message ?? String(e) }
  }
}

/**
 * Best-effort Razorpay sync — failures are logged, never surface to the caller.
 */
export async function razorpaySyncProduct(
  supabase: ReturnType<typeof createClient>,
  opts: SyncOptions,
): Promise<{ ok: boolean; error?: string }> {
  const { tenantId, productId, body, existingRazorpayPlanIds } = opts
  try {
    // Check Razorpay connection status (live keys preferred; fall back to test).
    const { data: rpStatus } = await supabase
      .rpc("tenant_providers_status", { p_tenant_id: tenantId, p_provider: "razorpay" })
      .single<{ test_key_id: string | null; live_key_id: string | null; connected: boolean }>()
    if (!rpStatus?.connected) return { ok: false, error: "Razorpay is not connected for this tenant" }

    // Every configured mode, not just the preferred one — see the note in stripeSyncProduct. The
    // old `live_key_id ? "live" : "test"` left `test_payment_links` empty on any tenant that had a
    // live key, and `/config` drops providers whose per-sku map is empty.
    const prices = buildPriceInputs(body)
    if (!prices.length) return { ok: false, error: "no pricing rows for this product" }

    const modes = ([rpStatus.live_key_id ? "live" : null, rpStatus.test_key_id ? "test" : null]
      .filter(Boolean) as ("live" | "test")[])
    if (modes.length === 0) modes.push("test")

    let lastResult: Awaited<ReturnType<typeof syncProductToRazorpay>> | null = null
    for (const mode of modes) {
      try {
        const result = await syncProductToRazorpay(
          tenantId,
          productId,
          body.display_name,
          body.type,
          body.interval ?? null,
          prices,
          mode,
          existingRazorpayPlanIds,
        )
        lastResult = result
        await supabase.rpc("tenant_providers_merge_payment_links", {
          p_tenant_id: tenantId,
          p_provider: "razorpay",
          p_mode: mode,
          p_sku: body.sku,
          p_payment_links: result.paymentLinksByCurrency,
        })
      } catch (e: any) {
        console.error(`[products] razorpay ${mode} sync failed:`, e?.message ?? e)
      }
    }
    if (!lastResult) return { ok: false, error: "razorpay sync failed for every configured mode" }

    await supabase.rpc("tenant_products_set_razorpay_ids", {
      p_id: productId,
      p_razorpay_plan_id_by_currency: lastResult.planIdsByCurrency,
    })

    // Nothing landed and every currency was rejected by Razorpay → tell the
    // operator exactly what to do (Razorpay is INR-first; USD-only products need
    // an INR price, or International payments enabled on the Razorpay account).
    const created =
      Object.keys(lastResult.planIdsByCurrency).length +
      Object.keys(lastResult.paymentLinksByCurrency).length
    if (created === 0 && lastResult.skippedCurrencies.length > 0) {
      return {
        ok: false,
        error: `Razorpay does not accept ${lastResult.skippedCurrencies.join(", ")} for this account. Add an INR price for this product (or enable International payments on Razorpay).`,
      }
    }
    return { ok: true }
  } catch (e: any) {
    // The Razorpay SDK rejects with a PLAIN OBJECT { statusCode, error: { code,
    // description, ... } } — NOT an Error instance — so e.message is undefined.
    // Dig out the real reason (e.g. "Currency is not supported") and surface it
    // instead of swallowing the failure behind a generic "check credentials".
    const detail =
      e?.error?.description ??
      e?.error?.error?.description ??
      e?.message ??
      (typeof e === "object" ? JSON.stringify(e) : String(e))
    const code = e?.statusCode ?? e?.error?.code
    const msg = `Razorpay${code ? ` [${code}]` : ""}: ${detail}`
    console.error("[products] razorpay sync failed:", msg)
    return { ok: false, error: msg }
  }
}

/**
 * Best-effort Cashfree sync — same shape as Stripe / Razorpay. Skips when
 * Cashfree isn't connected for this tenant; logs failures without
 * surfacing to caller.
 */
export async function cashfreeSyncProduct(
  supabase: ReturnType<typeof createClient>,
  opts: SyncOptions,
): Promise<{ ok?: boolean; skipped?: boolean; error?: string; reason?: string }> {
  const { tenantId, productId, body } = opts
  try {
    const { data: status } = await supabase
      .rpc("tenant_providers_status", { p_tenant_id: tenantId, p_provider: "cashfree" })
      .single<{ test_key_id: string | null; live_key_id: string | null; connected: boolean }>()
    if (!status?.connected) return { skipped: true, reason: "Cashfree is not connected" }

    const prices = buildPriceInputs(body)
    if (!prices.length) return { skipped: true, reason: "no pricing configured for this product" }

    // Every configured mode — see the note in stripeSyncProduct. Cashfree shared the same
    // `live_key_id ? "live" : "test"` single-mode choice, so a live-keyed tenant never produced a
    // test link and `/config` dropped the provider from every `pk_test_` build.
    const modes = ([status.live_key_id ? "live" : null, status.test_key_id ? "test" : null]
      .filter(Boolean) as ("live" | "test")[])
    if (modes.length === 0) modes.push("test")

    let synced = 0
    let lastSkipReason: string | null = null
    for (const mode of modes) {
      try {
        // Decrypt the key pair via the same RPC as Stripe — service_role can
        // pull it directly. For dashboard-side calls the user's session also
        // works via tenant_admins check.
        const { data: decrypted } = await supabase
          .rpc("tenant_providers_decrypt_key", {
            p_tenant_id: tenantId,
            p_provider: "cashfree",
            p_mode: mode,
          })
          .single<{ secret_key: string; key_id: string }>()
        if (!decrypted?.secret_key || !decrypted?.key_id) {
          lastSkipReason = "Cashfree credentials could not be read"
          continue
        }

        const result = await syncProductToCashfree(
          tenantId,
          productId,
          body.display_name,
          body.type,
          prices,
          decrypted.key_id,
          decrypted.secret_key,
          mode,
        )

        // Cashfree only supports one-time INR links today (subscriptions self-skip in
        // syncProductToCashfree, returning no links) — that's a SKIP, not a failure.
        if (Object.keys(result.paymentLinksByCurrency).length === 0) {
          lastSkipReason =
            body.type === "subscription"
              ? "Cashfree does not support subscriptions — use Razorpay/Stripe or UPI Autopay for recurring"
              : "Cashfree returned no payment link (only one-time INR is supported)"
          continue
        }

        await supabase.rpc("tenant_providers_merge_payment_links", {
          p_tenant_id: tenantId,
          p_provider: "cashfree",
          p_mode: mode,
          p_sku: body.sku,
          p_payment_links: result.paymentLinksByCurrency,
        })
        synced++
      } catch (e: any) {
        console.error(`[products] cashfree ${mode} sync failed:`, e?.message ?? e)
      }
    }
    if (synced === 0) {
      return { skipped: true, reason: lastSkipReason ?? "Cashfree sync produced no links" }
    }
    return { ok: true }
  } catch (e: any) {
    console.error("[products] cashfree sync failed:", e.message)
    return { error: e?.message ?? String(e) }
  }
}

/**
 * Best-effort Google Play sync — creates/updates the Play subscription (+ base
 * plan) for this product when the tenant has stored google_play credentials.
 * Same shape as cashfreeSyncProduct: probe status → decrypt tenant creds →
 * call the real Play Developer API → write the resulting product id back into
 * tenant_products.play_product_id. Failures are logged, never surfaced.
 *
 * Only subscription-type products are synced to a native store; one-time /
 * lifetime products are handled by the web-PSP lanes.
 */
export async function googlePlaySyncProduct(
  supabase: ReturnType<typeof createClient>,
  opts: SyncOptions,
): Promise<{ error?: string; warning?: string; skipped?: boolean; reason?: string }> {
  const { tenantId, productId, body, existingPlayProductId } = opts
  try {
    if (body.type !== "subscription") {
      return { skipped: true, reason: "native stores only sync subscription products" }
    }

    const { data: status } = await supabase
      .rpc("tenant_providers_store_status", { p_tenant_id: tenantId, p_provider: "google_play" })
      .single<{ connected: boolean; config: Record<string, any> }>()
    if (!status?.connected) return { error: "Google Play is not connected for this tenant" }

    const { data: decrypted } = await supabase
      .rpc("tenant_providers_decrypt_store_key", { p_tenant_id: tenantId, p_provider: "google_play" })
      .single<{ credential: string | null; config: Record<string, any> }>()
    if (!decrypted?.credential) return { error: "no stored Google Play service-account credential" }
    const packageName = decrypted.config?.package_name
    if (!packageName) {
      console.error("[products] google play sync skipped: no package_name in tenant store config")
      return { error: "no package_name in Google Play store config" }
    }

    const prices = buildPriceInputs(body).map((p) => ({
      currency: p.currency,
      amountCents: p.amountCents,
    }))

    // Free-trial length drives a FREE_TRIAL offer on the base plan so the Play
    // cart actually grants the trial the paywall advertises (Subscriptions policy).
    // Android reads the per-platform 'android' value (0 → W2 teardown removes the offer).
    const trialDays = resolvePlatformTrialDays(body, "android")

    const result = await syncProductToGooglePlay(
      { serviceAccountJson: decrypted.credential, packageName },
      productId,
      body.sku,
      body.display_name,
      body.interval ?? null,
      prices,
      existingPlayProductId,
      trialDays,
    )

    await supabase.rpc("tenant_products_set_store_ids", {
      p_id: productId,
      p_play_product_id: result.playProductId,
      p_app_store_product_id: null,
    })
    // The product synced, but its base plan may still be DRAFT (Play blocks
    // activation until the app is published). Surface that as a non-fatal
    // warning so the operator knows to upload an APK + re-sync, rather than
    // believing the subscription is already live/purchasable.
    if (!result.activated) {
      return {
        warning:
          result.activationError ??
          "synced, but the Play base plan is still DRAFT — publish the app on Play (upload an APK/AAB), then re-sync to activate it",
      }
    }
    // Base plan is live but the trial offer isn't — the paywall would advertise a
    // trial the cart can't grant. Surface it so the operator fixes it before ship.
    if (trialDays > 0 && result.trialOfferActivated === false) {
      return {
        warning:
          result.trialOfferError ??
          `base plan is live but the ${trialDays}-day free-trial offer is still DRAFT — re-sync after the app is published to activate it`,
      }
    }
    return {}
  } catch (e: any) {
    const msg = e?.message ?? String(e)
    console.error("[products] google play sync failed:", msg)
    return { error: msg }
  }
}

/**
 * Best-effort App Store Connect sync — creates/updates the ASC subscription (+
 * group, + price) for this product when the tenant has stored app_store
 * credentials, then writes the ASC productId back into
 * tenant_products.app_store_product_id. Same best-effort contract as above.
 */
export async function appStoreSyncProduct(
  supabase: ReturnType<typeof createClient>,
  opts: SyncOptions,
): Promise<{ error?: string; skipped?: boolean; reason?: string }> {
  const { tenantId, productId, body, existingAppStoreProductId } = opts
  try {
    if (body.type !== "subscription") {
      return { skipped: true, reason: "native stores only sync subscription products" }
    }

    const { data: status } = await supabase
      .rpc("tenant_providers_store_status", { p_tenant_id: tenantId, p_provider: "app_store" })
      .single<{ connected: boolean; config: Record<string, any> }>()
    if (!status?.connected) return { error: "App Store is not connected for this tenant" }

    const { data: decrypted } = await supabase
      .rpc("tenant_providers_decrypt_store_key", { p_tenant_id: tenantId, p_provider: "app_store" })
      .single<{ credential: string | null; config: Record<string, any> }>()
    if (!decrypted?.credential) return { error: "no stored App Store .p8 private key" }
    const cfg = decrypted.config ?? {}
    if (!cfg.key_id || !cfg.issuer_id || !cfg.bundle_id) {
      console.error("[products] app store sync skipped: missing key_id/issuer_id/bundle_id in tenant store config")
      return { error: "missing key_id/issuer_id/bundle_id in App Store store config" }
    }

    const prices = buildPriceInputs(body).map((p) => ({
      currency: p.currency,
      amountCents: p.amountCents,
    }))

    // iOS (App Store) reads the per-platform 'ios' value (0 → W2 teardown removes
    // the StoreKit introductory offer).
    const trialDays = resolvePlatformTrialDays(body, "ios")

    const result = await syncProductToAppStore(
      {
        keyId: cfg.key_id,
        issuerId: cfg.issuer_id,
        bundleId: cfg.bundle_id,
        privateKeyP8: decrypted.credential,
      },
      productId,
      body.sku,
      body.display_name,
      body.interval ?? null,
      prices,
      existingAppStoreProductId,
      trialDays,
    )

    await supabase.rpc("tenant_products_set_store_ids", {
      p_id: productId,
      p_play_product_id: null,
      p_app_store_product_id: result.appStoreProductId,
    })
    // A trial was requested but the StoreKit intro offer didn't set — surface it.
    if (trialDays > 0 && result.introductoryOfferActive === false) {
      return {
        error:
          result.introductoryOfferError ??
          `App Store subscription synced but the ${trialDays}-day free-trial introductory offer was not set`,
      }
    }
    return {}
  } catch (e: any) {
    const msg = e?.message ?? String(e)
    console.error("[products] app store sync failed:", msg)
    return { error: msg }
  }
}

// ─── Durable multi-provider sync orchestrator ────────────────────────────────

/** Per-provider sync outcome recorded to tenant_products.sync_state. */
export interface ProviderSyncEntry {
  status: "synced" | "draft" | "failed" | "skipped"
  error?: string
  warning?: string
  /**
   * Human reason for a non-`synced` status — ALWAYS set for skipped/failed/draft so
   * the UI never shows an opaque "skipped" without explaining why (not connected /
   * no pricing / product type unsupported / DRAFT-until-published / real error).
   */
  reason?: string
}

export interface ProductSyncSummary {
  /** Rollup written to tenant_products.sync_status. */
  status: "synced" | "partial" | "failed"
  /** Per-provider detail — the dashboard shows failures + reasons, and offers retry. */
  providers: Record<string, ProviderSyncEntry>
}

// "Provider not connected / not configured" is a SKIP, never a failure — a tenant
// who only sells on Google Play shouldn't see a "Stripe failed" error.
const NOT_CONNECTED_RE =
  /not connected|no stored|not configured|missing (package_name|key_id|issuer_id|bundle_id)/i

/**
 * Normalize any provider helper's return into a ProviderSyncEntry. Handles the
 * two shapes across the five helpers: {ok,skipped,error} (Stripe/Cashfree/Razorpay)
 * and {error,warning} (Google Play/App Store). An explicit `skipped` OR a
 * not-connected error → skipped; a `warning` (base synced, trial offer DRAFT) →
 * draft; any other error → failed; otherwise synced.
 */
export function classifyProvider(
  r: { ok?: boolean; skipped?: boolean; error?: string; warning?: string; reason?: string } | undefined,
): ProviderSyncEntry {
  if (!r) return { status: "skipped", reason: "provider returned no result" }
  if (r.skipped) return { status: "skipped", reason: r.reason ?? r.error ?? "not applicable" }
  if (r.error && NOT_CONNECTED_RE.test(r.error)) return { status: "skipped", reason: r.error }
  if (r.error) return { status: "failed", error: r.error, reason: r.error }
  if (r.warning) return { status: "draft", warning: r.warning, reason: r.warning }
  return { status: "synced" }
}

/**
 * Run the multi-provider product sync AND record a durable outcome so the live
 * dashboard can sync-on-save, show per-provider results, retry a failed provider
 * with the real reason, and never lose an interrupted sync ("save for later").
 *
 * Contract:
 *   1. Marks the product `syncing` up front (durability: a tab-close / function
 *      kill mid-run leaves a non-terminal state the unsynced banner re-picks up).
 *   2. Fans out to every provider (each self-skips when not connected; none throw).
 *   3. Classifies each: synced / draft (base ok, trial offer DRAFT) / failed / skipped.
 *   4. Records the rollup + per-provider detail via tenant_products_set_sync_state.
 *
 * Every helper now returns STRUCTURED status ({ok,skipped,error} or {error,warning}),
 * so each provider's result is classified precisely — no read-back id inference.
 */
export async function runProductSync(
  supabase: ReturnType<typeof createClient>,
  opts: SyncOptions,
): Promise<ProductSyncSummary> {
  const { productId, onlyProvider } = opts

  await supabase.rpc("tenant_products_set_sync_state", {
    p_id: productId,
    p_status: "syncing",
    p_state: null,
  })

  const runners: Record<string, () => Promise<any>> = {
    stripe: () => stripeSyncProduct(supabase, opts),
    razorpay: () => razorpaySyncProduct(supabase, opts),
    cashfree: () => cashfreeSyncProduct(supabase, opts),
    google_play: () => googlePlaySyncProduct(supabase, opts),
    app_store: () => appStoreSyncProduct(supabase, opts),
  }
  const keys = onlyProvider ? [onlyProvider] : Object.keys(runners)
  const product = opts.productName ?? "product"
  const emit = opts.runId
    ? (phase: string, provider: string | null, status: string | null, message: string) =>
        supabase
          .rpc("sync_event_emit", {
            p_run_id: opts.runId,
            p_tenant_id: opts.tenantId,
            p_product_id: productId,
            p_product_name: opts.productName ?? null,
            p_provider: provider,
            p_phase: phase,
            p_status: status,
            p_message: message,
          })
          .then(
            () => {},
            () => {},
          )
    : null

  // Emit a start + result event per provider so the dashboard renders a live log.
  const providers: Record<string, ProviderSyncEntry> = {}
  await Promise.all(
    keys.map(async (k) => {
      const label = PROVIDER_LABEL[k] ?? k
      if (emit) await emit("start", k, null, `Syncing ${product} → ${label}…`)
      const entry = classifyProvider(await runners[k]())
      providers[k] = entry
      if (emit) {
        const phase = entry.status === "failed" ? "failed" : entry.status === "skipped" ? "skipped" : "ok"
        await emit(phase, k, entry.status, providerSyncMessage(label, product, entry))
      }
    }),
  )

  const values = Object.values(providers)
  const status: ProductSyncSummary["status"] = values.some((v) => v.status === "failed")
    ? "failed"
    : values.some((v) => v.status === "draft")
      ? "partial"
      : "synced"

  await supabase.rpc("tenant_products_set_sync_state", {
    p_id: productId,
    p_status: status,
    p_state: providers,
  })

  if (emit) await emit("run_done", null, status, `${product}: ${status}`)

  return { status, providers }
}
