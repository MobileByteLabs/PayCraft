package com.mobilebytelabs.paycraft.config

import com.mobilebytelabs.paycraft.core.MonetizationMode
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.JsonElement

/**
 * Cloud-resolved configuration snapshot for a single tenant.
 *
 * Fetched from `GET /functions/v1/config?apiKey=…` and cached locally via [ConfigCache].
 * All product/pricing/provider/paywall decisions made in the dashboard arrive here.
 */
@Serializable
data class SuiteConfig(
    @SerialName("tenant_id") val tenantId: String,
    val plan: String? = null,
    val products: List<ProductDto> = emptyList(),
    val providers: List<ProviderDto> = emptyList(),
    val paywall: PaywallDto = PaywallDto(),
    /**
     * Offerings → packages → product SKUs (D8/AC-11).
     *
     * A component tree binds a plan card to a package ROLE (`$rc_annual`), never a SKU, so that a
     * tree survives store migrations and per-platform product ids. This is the only mapping from
     * that role to something purchasable. Empty for a tenant with no offerings, in which case a
     * tree's package nodes simply find no product and the paywall falls back to the template path.
     */
    val offerings: List<OfferingDto> = emptyList(),
    val locale: String = "US",
    /**
     * Monetization policy override (Phase-4 clean-SDK, AC-9). When present, wins over
     * the host-supplied init-time [MonetizationMode] via
     * [com.mobilebytelabs.paycraft.core.MonetizationModeResolver] so a dashboard flip
     * propagates without a host rebuild — same precedence as the theme pipeline.
     * `null` (default when the cloud response omits the field) leaves the init flag
     * in charge. Wire format: `"ad_supported"` / `"trial_managed"` (see
     * [MonetizationMode]'s @SerialName annotations).
     */
    val mode: MonetizationMode? = null,
    /**
     * The buyer country the PayCraft cloud resolved from the request's edge IP-country header
     * (`x-vercel-ip-country` / `cf-ipcountry` / `cloudfront-viewer-country`). ISO 3166-1 alpha-2,
     * or null when the hosting edge did not attach the header. Folded into the client's unified
     * [com.mobilebytelabs.paycraft.CountryDetector] resolution below the store storefront and above
     * the device locale — one consistent country signal on every platform.
     */
    @SerialName("geo_country") val geoCountry: String? = null,
    /** Provenance of [geoCountry]: `"SERVER_IP_GEO"` when resolved, `"ABSENT"` when no header. */
    @SerialName("geo_source") val geoSource: String? = null,
    @SerialName("cache_ttl_seconds") val cacheTtlSeconds: Int = 3600,
    // Set by the client on receipt; not returned by the server.
    @SerialName("fetched_at_epoch_millis") val fetchedAtEpochMillis: Long = 0L,
)

@Serializable
data class ProductDto(
    val id: String,
    val sku: String,
    val type: String, // "subscription" | "trial" | "lifetime"
    @SerialName("display_name") val displayName: String,
    @SerialName("trial_enabled") val trialEnabled: Boolean = true,
    @SerialName("trial_duration_days") val trialDurationDays: Int? = 7,
    @SerialName("attaches_to_product_id") val attachesToProductId: String? = null,
    val interval: String? = null, // "month" | "quarter" | "semiannual" | "year"
    @SerialName("base_price_cents") val basePriceCents: Int = 0,
    @SerialName("base_currency") val baseCurrency: String = "USD",
    @SerialName("display_order") val displayOrder: Int = 0,
    val active: Boolean = true,
    @SerialName("resolved_price") val resolvedPrice: PriceDto? = null,
    /**
     * Automatic percentage discount, 1..99. When set, the SDK paywall renders the
     * `base_price_cents` (and each per-locale price in `tenant_pricing`) with a
     * strike-through original and a discounted final amount. NULL = no discount.
     *
     * Applied automatically on checkout (Stripe Coupon attached) — the customer
     * does NOT type a code. For code-driven discounts use [CouponDto] instead.
     */
    @SerialName("discount_percent") val discountPercent: Int? = null,
    /** ISO 8601 timestamp when the auto-discount expires. NULL = no expiry. */
    @SerialName("discount_ends_at") val discountEndsAt: String? = null,
    /**
     * Google Play in-app-product / base-plan id (Google Play Billing v8). REQUIRED for this
     * product to be purchasable on Android — the SDK routes Android digital checkout through
     * Google Play Billing against this id (Payments-policy compliance). Configure it per product
     * in the PayCraft dashboard alongside the web payment links. NULL blocks Android checkout.
     */
    @SerialName("play_product_id") val playProductId: String? = null,
    /** Apple App Store product id (StoreKit2) — the iOS native lane counterpart of [playProductId]. */
    @SerialName("app_store_product_id") val appStoreProductId: String? = null,
)

/**
 * A code-driven discount the customer enters at checkout. The dashboard creates
 * these per-tenant via the Coupons page; the SDK exposes `PayCraft.applyCoupon()`
 * to validate one before kicking off checkout.
 *
 * `duration` mirrors Stripe's Coupon model:
 *   - `"once"`      — discount applied to first invoice only
 *   - `"repeating"` — applied for `durationInMonths` invoices, then drops off
 *   - `"forever"`   — applied to every invoice indefinitely
 *
 * The recurring subscription is created normally — Stripe attaches the coupon
 * to the subscription record, so renewals continue automatically with the
 * coupon's duration policy applied. The SDK does NOT need to re-validate the
 * coupon on each renewal; Stripe is the single source of truth.
 */
@Serializable
data class CouponDto(
    val id: String,
    val code: String,
    val name: String? = null,
    @SerialName("percent_off") val percentOff: Int,
    val duration: String, // "once" | "repeating" | "forever"
    @SerialName("duration_in_months") val durationInMonths: Int? = null,
    @SerialName("redeem_by") val redeemBy: String? = null,
)

@Serializable
data class PriceDto(@SerialName("amount_cents") val amountCents: Int, val currency: String, val source: String)

@Serializable
data class ProviderDto(
    val provider: String,
    /**
     * Nested per-(sku, currency) payment-link map — `{sku: {currency: url}}`.
     * Multi-product apps populate this; the SDK looks up
     * `testPaymentLinksBySku[plan.id]?[plan.currency]` first.
     * Server stores this shape in `tenant_providers.test_payment_links` JSONB.
     */
    @SerialName("test_payment_links")
    val testPaymentLinksBySku: Map<String, Map<String, String>> = emptyMap(),
    /**
     * Nested per-(sku, currency) payment-link map for live mode.
     * See [testPaymentLinksBySku].
     */
    @SerialName("live_payment_links")
    val livePaymentLinksBySku: Map<String, Map<String, String>> = emptyMap(),
    @SerialName("supported_locales") val supportedLocales: List<String>? = null,
    /**
     * The caller platform this provider was ordered for (`ios`/`android`/`desktop`/`web`), echoed
     * by `/config` from the `X-PayCraft-Platform` request header (migration 075). Informational —
     * the meaningful signal is the ORDER of [SuiteConfig.providers], which the SDK trusts as the
     * tenant's per-platform preference. Null when the server did not tag it.
     */
    @SerialName("platform") val platform: String? = null,
)

/**
 * Single bullet in the paywall's value-prop list, rendered by `ValuePropList` as
 * an icon-leading row under the hero subtitle. Server stores rich triples in
 * `tenant_paywall.value_props` JSONB; SDK deserializes them here.
 *
 * `icon` is a string key from a curated vocabulary (`ad-free`, `hd`, `unlimited`,
 * `priority`, `early`, `wifi`, `lock`, `star`, `heart`). Unknown keys fall back
 * to a generic check icon in the SDK render.
 */
@Serializable
data class ValuePropTriple(val icon: String, val title: String, val description: String? = null)

@Serializable
data class PaywallDto(
    // ── v1 (migration 030 baseline) ──────────────────────────────────────
    val template: String = "branded-stack",
    @SerialName("theme_jsonb") val themeJsonb: Map<String, String> = emptyMap(),
    val branding: String = "attribution",
    @SerialName("custom_footer") val customFooter: String? = null,
    @SerialName("primary_color") val primaryColor: String? = null,
    @SerialName("font_family") val fontFamily: String? = null,
    // ── v2 (migration 071, cmp-paycraft 2.1.0+) ─────────────────────────
    /** Hero title rendered above the plan stack (default: "Upgrade to Premium"). */
    @SerialName("hero_title") val heroTitle: String = "Upgrade to Premium",
    /** Sub-headline under the hero title (matches reels-downloader strings.xml default). */
    @SerialName("hero_subtitle")
    val heroSubtitle: String = "Enjoy ad-free experience, HD downloads, and exclusive features",
    /** Rich-triple bullet list rendered between hero subtitle and plan stack. Empty → list hidden. */
    @SerialName("value_props") val valueProps: List<ValuePropTriple> = emptyList(),
    /** Continue button label on the paywall (default: "Continue"). */
    @SerialName("cta_continue") val ctaContinue: String = "Continue",
    /** Get-premium button label on the Settings-tab banner (default: "Get Premium"). */
    @SerialName("cta_get_premium") val ctaGetPremium: String = "Get Premium",
    /** Restore-purchase link label (default: "Restore Your Premium"). */
    @SerialName("restore_label") val restoreLabel: String = "Restore Your Premium",
    /** Terms-of-service URL; null → no terms link in footer. */
    @SerialName("terms_url") val termsUrl: String? = null,
    /** Privacy-policy URL; null → no privacy link in footer. */
    @SerialName("privacy_url") val privacyUrl: String? = null,
    /** SKU of the plan card that renders the MOST POPULAR ring; null → no ring. */
    @SerialName("popular_plan_sku") val popularPlanSku: String? = null,
    /** Post-purchase celebration sheet title (PayCraftCheckoutSuccessSheet). */
    @SerialName("success_title") val successTitle: String = "Welcome to Premium!",
    /** Post-purchase celebration sheet message body. */
    @SerialName("success_message")
    val successMessage: String = "You now have access to all premium features.",
    /** Post-purchase celebration sheet CTA label. */
    @SerialName("success_cta_label") val successCtaLabel: String = "Continue to app",
    // ── Trial-terms disclosure (migration 077) ──────────────────────────
    // Play Subscriptions policy requires the paywall to clearly state the trial
    // length, the post-trial price + cadence, and how to cancel. These make that
    // copy fully tenant-configurable from the dashboard. Empty string → the SDK
    // falls back to its localized string-resource default (so an older tenant row
    // or the Mock backend still renders a compliant disclosure). Substitution
    // tokens the SDK replaces at render: `{days}` = trial length, `{price}` =
    // formatted "price / interval" (e.g. "₹299 / month").
    /** Per-plan trial-terms line, e.g. "{days}-day free trial, then {price}". Blank → SDK default. */
    @SerialName("trial_terms_template") val trialTermsTemplate: String = "",
    /** Trial disclosure block heading, e.g. "{days}-day free trial included". Blank → SDK default. */
    @SerialName("trial_disclosure_title") val trialDisclosureTitle: String = "",
    /** Trial disclosure body — the auto-renew + how-to-cancel legal line. Blank → SDK default. */
    @SerialName("trial_disclosure_body") val trialDisclosureBody: String = "",
    /**
     * Server-authored component tree (epic 2, `schema_version` 2+).
     *
     * NULLABLE AND ADDITIVE ON PURPOSE (D7). Every already-released SDK ignores this field, and a
     * tenant who has not published a tree gets `null` — so both keep rendering through the flat
     * columns above with no coordinated rollout and no version negotiation.
     *
     * Held as [JsonElement] rather than a typed model because the SDK must survive receiving a
     * NEWER tree than it understands: kotlinx would reject unknown node shapes at deserialization
     * and take the whole config down with it, whereas [com.mobilebytelabs.paycraft.presentation.tree.PaywallTreeParser]
     * walks it leniently and degrades node-by-node. Config decoding is the wrong place to be strict.
     *
     * `/config` sources this from `published_workflow` only — a draft can never arrive here.
     */
    @SerialName("workflow") val workflow: JsonElement? = null,
    /** Contract version the tree was authored against; 1 when there is no tree. */
    @SerialName("schema_version") val schemaVersion: Int = 1,
    /** Inline SVG path data for the hero icon. Sanitized server-side. */
    @SerialName("hero_icon_svg") val heroIconSvg: String? = null,
    /**
     * PNG fallback URL for the hero icon. **Reserved for cmp-paycraft 2.2.0+** —
     * 2.1.0 reads inline SVG only; this field is persisted but not consumed yet.
     */
    @SerialName("hero_icon_url") val heroIconUrl: String? = null,
    @SerialName("support_email") val supportEmail: String? = null,
)

/**
 * Effective theme-override map consumed by the unified `PayCraftThemeProvider(config = …)`
 * via `SuiteConfig.themeOverride` → `BrandedPalette` in `ui/theme/PayCraftColors.kt`.
 *
 * Merges the legacy [PaywallDto.themeJsonb] map with the dedicated [PaywallDto.primaryColor]
 * column. The dashboard Paywall designer writes the brand color into `primary_color`
 * (its own column), NOT into `theme_jsonb` — so without this merge the dashboard's
 * primary color silently drops and the paywall inherits the host app's MaterialTheme
 * primary (e.g. reels-downloader's blue) instead of the configured brand color.
 *
 * `primary_color` is authoritative: it overrides any legacy `theme_jsonb["primary"]`.
 */
val PaywallDto.effectiveThemeOverride: Map<String, String>
    get() = buildMap {
        putAll(themeJsonb)
        primaryColor?.takeIf { it.isNotBlank() }?.let { put("primary", it) }
    }

/** An offering: a named set of packages a tenant presents together. */
@Serializable
data class OfferingDto(
    val id: String = "",
    val identifier: String = "",
    @SerialName("display_name") val displayName: String = "",
    @SerialName("is_current") val isCurrent: Boolean = false,
    val packages: List<PackageDto> = emptyList(),
)

/**
 * A package: one ROLE, fronting one or more SKUs.
 *
 * [productSkus] is a list because a single role can front several store ids — Play and App Store
 * ship different product identifiers for what the user experiences as one plan.
 */
@Serializable
data class PackageDto(
    val id: String = "",
    @SerialName("role_identifier") val roleIdentifier: String = "",
    @SerialName("display_name") val displayName: String = "",
    @SerialName("display_order") val displayOrder: Int = 0,
    @SerialName("product_skus") val productSkus: List<String> = emptyList(),
)

/**
 * Resolve a package role to a concrete product, preferring the current offering.
 *
 * Returns null when the tenant has no offerings or the role fronts nothing purchasable — the caller
 * then renders the card without a price rather than inventing one. Showing a wrong price on a
 * paywall is worse than showing none.
 */
fun SuiteConfig.productForRole(role: String): ProductDto? {
    val ordered = offerings.sortedByDescending { it.isCurrent }
    for (offering in ordered) {
        val pkg = offering.packages.firstOrNull { it.roleIdentifier == role } ?: continue
        for (sku in pkg.productSkus) {
            products.firstOrNull { it.sku == sku }?.let { return it }
        }
    }
    return productForCanonicalRole(role)
}

/**
 * Resolve a CANONICAL role against the product catalogue directly, with no offerings involved.
 *
 * ## Why this is not a shortcut
 * Offerings are new. Every tenant onboarded before them has products and no `tenant_packages` rows,
 * so `productForRole` returns null for every role — and once the component tree became the render
 * path for everyone (D3), that turned into a paywall with a headline, a CTA and NOTHING TO BUY.
 * Found by running the real consumer app (cappy) against the real backend; no unit test, no golden
 * and no sample app could see it, because they all supply offerings.
 *
 * The canonical roles name a PERIOD, and so does every product, so the mapping needs no new data:
 * `${'$'}rc_annual` is the yearly subscription. That is a fallback, not a replacement — an explicit
 * offering always wins above, which is what lets a tenant sell two different annual plans.
 */
internal fun SuiteConfig.productForCanonicalRole(role: String): ProductDto? {
    // Ordered by the MERCHANT's own `display_order`, not by however the catalogue arrived.
    //
    // cappy sells two monthly products — "Cappy Plus (Monthly)" $6.99 (order 2) and "Warm Springs
    // Guardian" $7.99 (order 3). A role has to resolve to ONE of them, and "whichever the list
    // happened to put first" is a coin flip that decides what a customer is charged. Display order
    // is the merchant's declared answer to exactly that question, so it decides here too.
    //
    // A tenant who wants a role bound to a SPECIFIC product still says so with an offering, which
    // wins above. This only has to be defensible, deterministic and the merchant's own choice.
    val active = products.filter { it.active }.sortedBy { it.displayOrder }
    fun subs(interval: String) = active.firstOrNull {
        it.type == "subscription" && it.interval.equals(interval, ignoreCase = true)
    }
    return when (role.removePrefix("${'$'}rc_").lowercase()) {
        "annual", "yearly", "year" -> subs("year")
        "monthly", "month" -> subs("month")
        "six_month", "semiannual" -> subs("semiannual")
        "three_month", "quarterly", "quarter" -> subs("quarter")
        "weekly", "week" -> subs("week")
        "lifetime" -> active.firstOrNull { it.type == "lifetime" }
        else -> null
    }
}
